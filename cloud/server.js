import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const dbFile=process.env.LUME_DB||path.join(root,'data.json');
const secret=process.env.LUME_SESSION_SECRET||'change-this-secret-before-deploying';
const donationUrl=process.env.LUME_DONATION_URL||'';
function readDb(){try{return JSON.parse(fs.readFileSync(dbFile,'utf8'))}catch{return{users:[]}}}
function writeDb(db){fs.mkdirSync(path.dirname(dbFile),{recursive:true});fs.writeFileSync(dbFile,JSON.stringify(db,null,2))}
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'});res.end(JSON.stringify(data))}
function token(id){const body=Buffer.from(JSON.stringify({sub:id,exp:Date.now()+1000*60*60*24*30})).toString('base64url');return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url')}
function secureEqual(a,b){const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&crypto.timingSafeEqual(left,right)}
function auth(req){const raw=req.headers.authorization||'';if(!raw.startsWith('Bearer '))return null;const [body,sig]=raw.slice(7).split('.');const expected=body?crypto.createHmac('sha256',secret).update(body).digest('base64url'):'';if(!body||!sig||!secureEqual(sig,expected))return null;try{const value=JSON.parse(Buffer.from(body,'base64url'));return value.exp>Date.now()?value:null}catch{return null}}
function hash(password,salt=crypto.randomBytes(16).toString('hex')){return new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,(e,key)=>e?reject(e):resolve({salt,hash:key.toString('hex')})))}
function body(req){return new Promise((resolve,reject)=>{let data='';req.on('data',chunk=>{data+=chunk;if(data.length>1e6)req.destroy()});req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch{reject(new Error('JSON inválido'))}});req.on('error',reject)})}
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),db=readDb();
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'content-type, authorization'});return res.end()}
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true,service:'lume-games-api'});
  if(req.method==='GET'&&url.pathname==='/release/latest')return json(res,200,{version:process.env.LUME_LATEST_VERSION||'0.0.0',url:process.env.LUME_RELEASE_URL||''});
  if(req.method==='GET'&&url.pathname==='/catalog')return json(res,200,{sources:[],message:'O catálogo permanece no dispositivo do usuário até que fontes autorizadas sejam configuradas.'});
  if(req.method==='GET'&&url.pathname==='/donations/config')return json(res,200,{url:donationUrl,message:'Apoie o projeto se desejar. A doação é opcional.'});
  if(req.method==='POST'&&url.pathname==='/auth/register'){const input=await body(req),email=String(input.email||'').trim().toLowerCase(),password=String(input.password||'');if(!/^\S+@\S+\.\S+$/.test(email)||password.length<8)return json(res,400,{error:'E-mail ou senha inválidos.'});if(db.users.some(u=>u.email===email))return json(res,409,{error:'Conta já cadastrada.'});const credentials=await hash(password);const user={id:crypto.randomUUID(),email,createdAt:new Date().toISOString(),...credentials};db.users.push(user);writeDb(db);return json(res,201,{token:token(user.id),user:{id:user.id,email}})}
  if(req.method==='POST'&&url.pathname==='/auth/login'){const input=await body(req),user=db.users.find(u=>u.email===String(input.email||'').trim().toLowerCase());if(!user)return json(res,401,{error:'Credenciais inválidas.'});const credentials=await hash(String(input.password||''),user.salt);if(!crypto.timingSafeEqual(Buffer.from(credentials.hash,'hex'),Buffer.from(user.hash,'hex')))return json(res,401,{error:'Credenciais inválidas.'});return json(res,200,{token:token(user.id),user:{id:user.id,email:user.email}})}
  if(req.method==='GET'&&url.pathname==='/me'){const value=auth(req);if(!value)return json(res,401,{error:'Sessão inválida.'});const user=db.users.find(u=>u.id===value.sub);return json(res,user?200:401,user?{user:{id:user.id,email:user.email}}:{error:'Sessão inválida.'})}
  return json(res,404,{error:'Rota não encontrada.'});
}catch(error){return json(res,400,{error:error.message||'Erro interno.'})}});
server.listen(Number(process.env.PORT)||8080,()=>console.log('Lume Games API pronta'));

