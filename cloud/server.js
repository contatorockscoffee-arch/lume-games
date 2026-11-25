import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const dbFile=process.env.LUME_DB||path.join(root,'data.json');
const secret=process.env.LUME_SESSION_SECRET||'change-this-secret-before-deploying';
const donationUrl=process.env.LUME_DONATION_URL||'';
// Saves na nuvem: arquivos no volume (Railway: /data), um índice por usuário.
const savesRoot=process.env.LUME_SAVES_DIR||path.join(path.dirname(dbFile),'saves');
const quotaBytes=(Number(process.env.LUME_SAVE_QUOTA_MB)||256)*1024*1024;
const maxFileBytes=(Number(process.env.LUME_SAVE_MAX_FILE_MB)||48)*1024*1024;
const keepVersions=3; // versões anteriores guardadas de cada save (desfazer conflito)
const publicUrl=()=>process.env.LUME_PUBLIC_URL||(process.env.RAILWAY_PUBLIC_DOMAIN?'https://'+process.env.RAILWAY_PUBLIC_DOMAIN:'http://localhost:'+(Number(process.env.PORT)||8080));

function readDb(){try{return JSON.parse(fs.readFileSync(dbFile,'utf8'))}catch{return{users:[]}}}
function writeDb(db){fs.mkdirSync(path.dirname(dbFile),{recursive:true});const tmp=dbFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,dbFile)}
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'content-type, authorization, x-lume-base','access-control-allow-methods':'GET, POST, PUT, DELETE, OPTIONS','access-control-expose-headers':'x-lume-mtime, x-lume-sha256'};
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...CORS});res.end(JSON.stringify(data))}
function text(res,status,data,type='text/plain; charset=utf-8'){res.writeHead(status,{'content-type':type,...CORS});res.end(data)}
// Sessão: e-mail/senha = 30 dias; aparelho vinculado por código (PS4) = 1 ano, revogável.
function token(id,extra={},days=30){const body=Buffer.from(JSON.stringify({sub:id,...extra,exp:Date.now()+1000*60*60*24*days})).toString('base64url');return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url')}
function secureEqual(a,b){const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&crypto.timingSafeEqual(left,right)}
function auth(req,db){const raw=req.headers.authorization||'';if(!raw.startsWith('Bearer '))return null;const [body,sig]=raw.slice(7).split('.');const expected=body?crypto.createHmac('sha256',secret).update(body).digest('base64url'):'';if(!body||!sig||!secureEqual(sig,expected))return null;let value;try{value=JSON.parse(Buffer.from(body,'base64url'))}catch{return null}if(!(value.exp>Date.now()))return null;const user=db.users.find(u=>u.id===value.sub);if(!user)return null;let touched=false;if(value.dev){const dev=(user.devices||[]).find(d=>d.id===value.dev);if(!dev)return null;if(!dev.lastSeen||Date.now()-Date.parse(dev.lastSeen)>3600e3){dev.lastSeen=new Date().toISOString();touched=true}}return{...value,user,touched}}
function hash(password,salt=crypto.randomBytes(16).toString('hex')){return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,key)=>e?reject(e):resolve({salt,hash:key.toString('hex')})))}
function body(req){return new Promise((resolve,reject)=>{let data='';req.on('data',chunk=>{data+=chunk;if(data.length>1e6)req.destroy()});req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch{reject(new Error('JSON inválido'))}});req.on('error',reject)})}
function rawBody(req,limit){return new Promise((resolve,reject)=>{const parts=[];let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>limit){reject(Object.assign(new Error('Arquivo grande demais.'),{status:413}));req.destroy();return}parts.push(chunk)});req.on('end',()=>resolve(Buffer.concat(parts)));req.on('error',reject)})}

// Limite simples por IP (protege login e pareamento de tentativa e erro).
const hits=new Map();
function limited(req,bucket,max,windowMs=10*60*1000){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();const key=bucket+'|'+ip,now=Date.now();let h=hits.get(key);if(!h||h.reset<now){h={count:0,reset:now+windowMs};hits.set(key,h)}h.count++;if(hits.size>50000)for(const [k,v] of hits)if(v.reset<now)hits.delete(k);return h.count>max}

// ---------- Vincular aparelho por código (o PS4 mostra o código; a pessoa confirma no celular ou no desktop)
const pairings=new Map(); // pollId -> {code,name,expires,token,email}
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(){let c='';for(let i=0;i<6;i++)c+=CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];return c}
function cleanCode(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
function sweepPairings(){const now=Date.now();for(const [k,v] of pairings)if(v.expires<now-60000)pairings.delete(k)}

// ---------- Saves
// Caminhos aceitos: saves/<console>/<arquivo>  e  states/<aparelho>/<console>/<arquivo>
const SEG=/^[^/\\\u0000-\u001f<>:"|?*]{1,200}$/;
function savePathOk(p){if(typeof p!=='string'||p.length>400)return false;const s=p.split('/');if(!s.every(x=>SEG.test(x)&&x!=='.'&&x!=='..'&&x.trim()===x))return false;return(s[0]==='saves'&&s.length===3)||(s[0]==='states'&&s.length===4)}
const userDir=id=>path.join(savesRoot,id.replace(/[^a-zA-Z0-9-]/g,''));
const blobName=p=>crypto.createHash('sha256').update(p).digest('hex');
async function readIndex(id){try{return JSON.parse(await fsp.readFile(path.join(userDir(id),'index.json'),'utf8'))}catch{return{files:{}}}}
async function writeIndex(id,index){const dir=userDir(id);await fsp.mkdir(dir,{recursive:true});const tmp=path.join(dir,'index.json.tmp');await fsp.writeFile(tmp,JSON.stringify(index));await fsp.rename(tmp,path.join(dir,'index.json'))}
const used=index=>Object.values(index.files).reduce((a,f)=>a+f.size,0);
async function keepOldVersion(id,name){const dir=path.join(userDir(id),'blobs'),cur=path.join(dir,name+'.bin');try{await fsp.rename(cur,path.join(dir,name+'.'+Date.now()+'.old'))}catch{return}const olds=(await fsp.readdir(dir)).filter(f=>f.startsWith(name+'.')&&f.endsWith('.old')).sort();for(const f of olds.slice(0,Math.max(0,olds.length-keepVersions)))await fsp.rm(path.join(dir,f),{force:true})}
// Uma escrita por usuário por vez (o índice é um arquivo só)
const locks=new Map();
function withLock(id,fn){const prev=locks.get(id)||Promise.resolve();const run=prev.then(fn,fn);locks.set(id,run.catch(()=>{}));return run}

function linkPage(code){const c=cleanCode(code).slice(0,6);return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar aparelho — Lume Games</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0d0b24;color:#eef;display:flex;min-height:100vh;align-items:center;justify-content:center}main{width:min(420px,92vw);background:#1a1740;border:1px solid #3b3480;border-radius:18px;padding:28px}h1{font-size:22px;margin:0 0 6px}p{color:#b9b6e0;font-size:15px;line-height:1.45}label{display:block;font-size:13px;color:#b9b6e0;margin:14px 0 6px}input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid #4a43a0;background:#0f0d2c;color:#fff;font-size:16px}#code{font-size:26px;letter-spacing:6px;text-align:center;text-transform:uppercase}button{width:100%;margin-top:20px;padding:14px;border:0;border-radius:12px;background:#26e4f5;color:#081028;font-weight:700;font-size:16px}a{color:#26e4f5}.msg{margin-top:16px;font-size:15px}.ok{color:#7ff0a8}.err{color:#ff8a9a}</style></head>
<body><main><h1>Conectar aparelho</h1><p>Digite o código que aparece na tela do PS4 e entre na sua conta Lume. Os saves dos jogos passam a ficar guardados na nuvem.</p>
<form id="f"><label for="code">Código do aparelho</label><input id="code" maxlength="7" autocomplete="off" value="${c}" required>
<label for="email">E-mail</label><input id="email" type="email" autocomplete="username" required>
<label for="pass">Senha</label><input id="pass" type="password" autocomplete="current-password" minlength="8" required>
<button id="go">Entrar e conectar</button></form>
<p style="margin-top:14px;font-size:14px">Ainda não tem conta? <a href="#" id="toggle">Criar conta agora</a></p><div id="msg" class="msg"></div></main>
<script>let register=false;const $=id=>document.getElementById(id);
$('toggle').onclick=e=>{e.preventDefault();register=!register;$('go').textContent=register?'Criar conta e conectar':'Entrar e conectar';$('toggle').textContent=register?'Já tenho conta':'Criar conta agora';$('pass').autocomplete=register?'new-password':'current-password'};
$('f').onsubmit=async e=>{e.preventDefault();const msg=$('msg');msg.className='msg';msg.textContent='Conectando…';$('go').disabled=true;
try{const r=await fetch(register?'/auth/register':'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:$('email').value,password:$('pass').value})});const a=await r.json();if(!r.ok)throw new Error(a.error||'Não deu para entrar.');
const p=await fetch('/device/approve',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+a.token},body:JSON.stringify({code:$('code').value})});const b=await p.json();if(!p.ok)throw new Error(b.error||'Código inválido.');
msg.className='msg ok';msg.textContent='Pronto! O aparelho "'+b.device+'" está conectado à conta '+a.user.email+'. Pode voltar para o PS4.';$('f').style.display='none'}catch(err){msg.className='msg err';msg.textContent=err.message}finally{$('go').disabled=false}};</script></body></html>`}

const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),db=readDb();
  if(req.method==='OPTIONS'){res.writeHead(204,CORS);return res.end()}
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,service:'lume-games-api'});
  if(req.method==='GET'&&url.pathname==='/release/latest')return json(res,200,{version:process.env.LUME_LATEST_VERSION||'0.0.0',url:process.env.LUME_RELEASE_URL||''});
  if(req.method==='GET'&&url.pathname==='/catalog')return json(res,200,{sources:[],message:'O catálogo permanece no dispositivo do usuário até que fontes autorizadas sejam configuradas.'});
  if(req.method==='GET'&&url.pathname==='/donations/config')return json(res,200,{url:donationUrl,message:'Apoie o projeto se desejar. A doação é opcional.'});
  if(req.method==='POST'&&url.pathname==='/auth/register'){if(limited(req,'auth',30))return json(res,429,{error:'Muitas tentativas. Espere alguns minutos.'});const input=await body(req),email=String(input.email||'').trim().toLowerCase(),password=String(input.password||'');if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return json(res,400,{error:'E-mail ou senha inválidos (a senha precisa de 8 caracteres ou mais).'});if(db.users.some(u=>u.email===email))return json(res,409,{error:'Conta já cadastrada.'});const credentials=await hash(password);const user={id:crypto.randomUUID(),email,createdAt:new Date().toISOString(),...credentials};db.users.push(user);writeDb(db);return json(res,201,{token:token(user.id),user:{id:user.id,email}})}
  if(req.method==='POST'&&url.pathname==='/auth/login'){if(limited(req,'auth',30))return json(res,429,{error:'Muitas tentativas. Espere alguns minutos.'});const input=await body(req),user=db.users.find(u=>u.email===String(input.email||'').trim().toLowerCase());if(!user)return json(res,401,{error:'Credenciais inválidas.'});const credentials=await hash(String(input.password||''),user.salt);if(!crypto.timingSafeEqual(Buffer.from(credentials.hash,'hex'),Buffer.from(user.hash,'hex')))return json(res,401,{error:'Credenciais inválidas.'});return json(res,200,{token:token(user.id),user:{id:user.id,email:user.email}})}
  if(req.method==='GET'&&url.pathname==='/me'){const value=auth(req,db);if(!value)return json(res,401,{error:'Sessão inválida.'});return json(res,200,{user:{id:value.user.id,email:value.user.email},device:value.dev||null})}

  // ----- aparelhos
  if(req.method==='GET'&&(url.pathname==='/vincular'||url.pathname==='/link'))return text(res,200,linkPage(url.searchParams.get('c')),'text/html; charset=utf-8');
  if(req.method==='POST'&&url.pathname==='/device/start'){if(limited(req,'pair',20))return json(res,429,{error:'Muitas tentativas. Espere alguns minutos.'});sweepPairings();const input=await body(req).catch(()=>({}));const name=String(input.name||'PS4').slice(0,40);let code;do code=newCode();while([...pairings.values()].some(p=>p.code===code));const pollId=crypto.randomBytes(24).toString('base64url');pairings.set(pollId,{code,name,expires:Date.now()+10*60*1000});const link=publicUrl()+'/vincular?c='+code;return json(res,200,{code,pollId,expiresIn:600,url:publicUrl()+'/vincular',link})}
  if(req.method==='GET'&&url.pathname==='/device/poll'){const p=pairings.get(String(url.searchParams.get('id')||''));if(!p||p.expires<Date.now())return json(res,410,{error:'Código expirado.'});if(!p.token)return json(res,202,{status:'pending'});pairings.delete(String(url.searchParams.get('id')));return json(res,200,{status:'ok',token:p.token,email:p.email})}
  if(req.method==='POST'&&url.pathname==='/device/approve'){if(limited(req,'approve',30))return json(res,429,{error:'Muitas tentativas. Espere alguns minutos.'});const value=auth(req,db);if(!value)return json(res,401,{error:'Sessão inválida.'});const code=cleanCode((await body(req)).code);const p=[...pairings.values()].find(x=>x.code===code&&x.expires>Date.now()&&!x.token);if(!p)return json(res,404,{error:'Código não encontrado ou expirado. Gere outro no aparelho.'});const dev={id:crypto.randomUUID(),name:p.name,createdAt:new Date().toISOString()};value.user.devices=[...(value.user.devices||[]),dev];writeDb(db);p.token=token(value.user.id,{dev:dev.id},365);p.email=value.user.email;return json(res,200,{ok:true,device:dev.name})}
  if(req.method==='GET'&&url.pathname==='/devices'){const value=auth(req,db);if(!value)return json(res,401,{error:'Sessão inválida.'});return json(res,200,{devices:(value.user.devices||[]).map(({id,name,createdAt,lastSeen})=>({id,name,createdAt,lastSeen}))})}
  if(req.method==='POST'&&url.pathname==='/devices/revoke'){const value=auth(req,db);if(!value)return json(res,401,{error:'Sessão inválida.'});const id=String((await body(req)).id||value.dev||'');value.user.devices=(value.user.devices||[]).filter(d=>d.id!==id);writeDb(db);return json(res,200,{ok:true})}

  // ----- saves
  if(url.pathname==='/saves'||url.pathname==='/saves/file'){
    const value=auth(req,db);if(!value)return json(res,401,{error:'Sessão inválida.'});
    if(value.touched)writeDb(db); // lastSeen do aparelho (no máximo 1 vez por hora)
    const uid=value.user.id;
    if(req.method==='GET'&&url.pathname==='/saves'){const index=await readIndex(uid);const files=Object.entries(index.files).map(([p,f])=>({path:p,size:f.size,mtime:f.mtime,sha256:f.sha256,updatedAt:f.updatedAt,device:f.device||''}));
      if(url.searchParams.get('format')==='tsv')return text(res,200,files.map(f=>[f.path,f.size,f.mtime,f.sha256].join('\t')).join('\n')+(files.length?'\n':''));
      return json(res,200,{files,usedBytes:used(index),quotaBytes})}
    const p=url.searchParams.get('p')||'';if(!savePathOk(p))return json(res,400,{error:'Caminho de save inválido.'});
    const name=blobName(p),blob=path.join(userDir(uid),'blobs',name+'.bin');
    if(req.method==='GET'){const index=await readIndex(uid),f=index.files[p];if(!f)return json(res,404,{error:'Save não encontrado.'});const data=await fsp.readFile(blob);res.writeHead(200,{'content-type':'application/octet-stream','content-length':data.length,'x-lume-mtime':String(f.mtime),'x-lume-sha256':f.sha256,...CORS});return res.end(data)}
    if(req.method==='PUT'){const data=await rawBody(req,maxFileBytes);const sha=crypto.createHash('sha256').update(data).digest('hex');const mtime=Math.floor(Number(url.searchParams.get('mtime'))||Date.now()/1000);const base=String(req.headers['x-lume-base']||'');const force=url.searchParams.get('force')==='1';
      return await withLock(uid,async()=>{const index=await readIndex(uid),cur=index.files[p];
        if(cur&&cur.sha256===sha){cur.mtime=Math.max(cur.mtime,mtime);await writeIndex(uid,index);return json(res,200,{ok:true,sha256:sha,unchanged:true})}
        if(!force&&base&&(cur?cur.sha256:'none')!==base)return json(res,409,{error:'O save mudou na nuvem desde a última sincronização.',current:cur?{size:cur.size,mtime:cur.mtime,sha256:cur.sha256}:null});
        if(used(index)-(cur?cur.size:0)+data.length>quotaBytes)return json(res,413,{error:'Espaço da nuvem cheio para esta conta.'});
        await fsp.mkdir(path.dirname(blob),{recursive:true});if(cur)await keepOldVersion(uid,name);
        const tmp=blob+'.tmp';await fsp.writeFile(tmp,data);await fsp.rename(tmp,blob);
        index.files[p]={size:data.length,mtime,sha256:sha,updatedAt:new Date().toISOString(),device:value.dev?((value.user.devices||[]).find(d=>d.id===value.dev)||{}).name||'':'desktop'};
        await writeIndex(uid,index);return json(res,200,{ok:true,sha256:sha})})}
    if(req.method==='DELETE')return await withLock(uid,async()=>{const index=await readIndex(uid);if(!index.files[p])return json(res,404,{error:'Save não encontrado.'});await keepOldVersion(uid,name);delete index.files[p];await writeIndex(uid,index);return json(res,200,{ok:true})});
  }
  return json(res,404,{error:'Rota não encontrada.'});
}catch(error){return json(res,error.status||400,{error:error.message||'Erro interno.'})}});
server.listen(Number(process.env.PORT)||8080,()=>console.log('Lume Games API pronta'));
