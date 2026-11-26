const {app,BrowserWindow,ipcMain,dialog,shell,powerSaveBlocker,session}=require('electron');
const path=require('path');
const fs=require('fs');
const fsp=fs.promises;
const os=require('os');
const {Readable}=require('stream');
const {pipeline}=require('node:stream/promises');
const {randomUUID}=require('node:crypto');
const ftp=require('basic-ftp');
const {autoUpdater}=require('electron-updater');
const {extractArchive}=require('./extract');
const {lookupWikiGames}=require('./wiki-metadata');
const {githubCatalogUrl,publicHttps}=require('./app/catalog-json');
const {registerFtpExplorer}=require('./ftp-explorer');

let mainWindow;
const archiveSession=()=>session.fromPartition('persist:lume-archive');
const send=(channel,data)=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send(channel,data)};
const activeDownloadControllers=new Map();

function createWindow(){
  mainWindow=new BrowserWindow({
    width:1440,height:900,minWidth:960,minHeight:640,
    backgroundColor:'#070817',title:'Lume',icon:path.join(__dirname,'app','lume.png'),
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname,'app','index.html'));
  mainWindow.webContents.setWindowOpenHandler(({url})=>{shell.openExternal(url);return{action:'deny'}});
}

app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});
app.whenReady().then(()=>{
  if(!app.isPackaged)return;
  autoUpdater.autoDownload=false;
  autoUpdater.on('update-available',info=>send('app-update',{state:'available',version:info.version}));
  autoUpdater.on('update-downloaded',info=>send('app-update',{state:'ready',version:info.version}));
  autoUpdater.on('error',error=>send('app-update',{state:'error',message:error.message}));
  autoUpdater.checkForUpdates().catch(()=>{});
});
ipcMain.handle('app-update-download',async()=>{await autoUpdater.downloadUpdate();return{ok:true}});
ipcMain.handle('app-update-install',async()=>{autoUpdater.quitAndInstall();return{ok:true}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});

function safeFileName(name){return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g,'_')}
async function packageStream(body,host){
  const reader=body.getReader(),chunks=[];
  let size=0;
  try{
    while(size<4){
      const {value,done}=await reader.read();
      if(done)break;
      chunks.push(Buffer.from(value));
      size+=value.length;
    }
    const signature=Buffer.concat(chunks).subarray(0,4).toString('hex');
    if(signature!=='7f434e54'&&signature!=='7f504b47'){
      throw new Error('O servidor '+host+' não entregou um arquivo PKG válido. Use um link direto autorizado.');
    }
  }catch(error){await reader.cancel().catch(()=>{});throw error}
  return Readable.from((async function*(){
    try{
      yield* chunks;
      while(true){
        const {value,done}=await reader.read();
        if(done)return;
        yield Buffer.from(value);
      }
    }finally{await reader.cancel().catch(()=>{})}
  })());
}

async function downloadToImpl(url,target,operation,originalName=target,jobId,signal){
  const current=publicHttps(url);
  if(!current)throw new Error('O download precisa usar um endereço HTTPS público.');
  const parsed=new URL(current);
  const partial=target+'.part';
  let existing=0;
  try{existing=(await fsp.stat(partial)).size}catch{}
  const headers=existing?{Range:`bytes=${existing}-`}:{};
  let response=await ((parsed.hostname==='archive.org'||parsed.hostname.endsWith('.archive.org'))
    ?archiveSession().fetch(current,{redirect:'follow',signal,headers})
    :fetch(current,{redirect:'follow',signal,headers}));
  // Alguns servidores não aceitam retomada; nesse caso reiniciamos de forma segura.
  if(existing&&response.status!==206){await response.body?.cancel();existing=0;response=await ((parsed.hostname==='archive.org'||parsed.hostname.endsWith('.archive.org'))
    ?archiveSession().fetch(current,{redirect:'follow',signal})
    :fetch(current,{redirect:'follow',signal}));}
  const finalUrl=response.url||current;
  const host=new URL(finalUrl).hostname;
  const isPackage=/\.pkg$/i.test(originalName);
  if(!response.ok||!response.body){
    await response.body?.cancel();
    if(response.status===401)throw new Error('O servidor '+host+' exige autorização para este arquivo (HTTP 401).');
    if(response.status===403)throw new Error('O servidor '+host+' recusou o download (HTTP 403).');
    throw new Error('Falha no download em '+host+' (HTTP '+response.status+').');
  }
  if(/\.(?:pkg|zip|rar|7z)(?:\.\d+)?$/i.test(originalName)&&
     /(?:text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type')||'')){
    await response.body.cancel();
    throw new Error('O servidor '+host+' entregou uma página HTML em vez do arquivo. Use um link direto autorizado.');
  }
  const total=(Number(response.headers.get('content-length'))||0)+existing;
  let done=existing,lastUpdate=0;
  const publish=()=>send('transfer-progress',{
    jobId,operation,phase:'download',host,done,total,percent:total?Math.min(100,done/total*100):null
  });
  const stream=isPackage&&!existing?await packageStream(response.body,host):Readable.fromWeb(response.body);
  publish();
  stream.on('data',chunk=>{
    done+=chunk.length;
    const now=Date.now();
    if(now-lastUpdate>=200){lastUpdate=now;publish()}
  });
  try{
    await pipeline(stream,fs.createWriteStream(partial,{flags:existing?'a':'w'}));
    await fsp.rename(partial,target);
    publish();
  }finally{}
}
async function downloadTo(...args){
  const controller=new AbortController();
  const key=args[4]||randomUUID();
  activeDownloadControllers.set(key,controller);
  try{return await downloadToImpl(...args,controller.signal)}
  finally{activeDownloadControllers.delete(key)}
}
ipcMain.handle('cancel-download',async(_event,jobId)=>{if(jobId)activeDownloadControllers.get(jobId)?.abort();else for(const controller of activeDownloadControllers.values())controller.abort();return{ok:true}});
ipcMain.handle('pause-download',async(_event,jobId)=>{if(jobId)activeDownloadControllers.get(jobId)?.abort();else for(const controller of activeDownloadControllers.values())controller.abort();return{ok:true}});

ipcMain.handle('archive-login',async()=>{
  const win=new BrowserWindow({width:1100,height:760,parent:mainWindow,modal:true,show:true,
    title:'Entrar no Internet Archive',webPreferences:{partition:'persist:lume-archive',contextIsolation:true,nodeIntegration:false}});
  await win.loadURL('https://archive.org/account/login.php');
  return new Promise(resolve=>{win.on('closed',()=>resolve({ok:true}))});
});
ipcMain.handle('archive-logout',async()=>{await archiveSession().clearStorageData({storages:['cookies']});return{ok:true}});
ipcMain.handle('archive-auth-status',async()=>{
  const cookies=await archiveSession().cookies.get({domain:'archive.org'});
  return{authenticated:cookies.some(cookie=>/logged-in|cookie|a/.test(cookie.name))};
});
ipcMain.handle('archive-sync-session',async(_event,{apiUrl,token}={})=>{
  const base=String(apiUrl||'').trim().replace(/\/$/,'');
  if(!/^https:\/\//i.test(base)||!token)throw new Error('Conecte a conta Lume antes de sincronizar a sessão do Archive.');
  const cookies=await archiveSession().cookies.get({domain:'archive.org'});
  if(!cookies.length)throw new Error('Entre no Internet Archive neste computador antes de sincronizar.');
  const response=await fetch(base+'/archive/session',{method:'PUT',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({cookies})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Não foi possível sincronizar a sessão do Archive.');
  return data;
});
ipcMain.handle('archive-session-status',async(_event,{apiUrl,token}={})=>{
  const base=String(apiUrl||'').trim().replace(/\/$/,'');
  if(!/^https:\/\//i.test(base)||!token)return{authenticated:false,enabled:false};
  const response=await fetch(base+'/archive/session',{headers:{authorization:'Bearer '+token}});
  return response.ok?response.json():{authenticated:false,enabled:false};
});

let lastExtractedFolder;
const extractedFolders=new Set(),reservedPaths=new Set();
let awakeId=null;
ipcMain.on?.('queue-activity',(_event,active)=>{
  if(active&&awakeId===null)awakeId=powerSaveBlocker.start('prevent-app-suspension');
  if(!active&&awakeId!==null){powerSaveBlocker.stop(awakeId);awakeId=null}
});
ipcMain.handle('pick-download-folder',async()=>{
  const selected=await dialog.showOpenDialog(mainWindow,{
    title:'Pasta para os downloads da fila',properties:['openDirectory','createDirectory']
  });
  return selected.canceled?null:selected.filePaths[0];
});
async function downloadFolder(folder){
  const target=folder||app.getPath('downloads');
  if(!path.isAbsolute(target)||(await fsp.stat(target)).isDirectory()===false){
    throw new Error('A pasta de downloads não está disponível.');
  }
  return target;
}
async function reserveDownloadPath(folder,name){
  const parsed=path.parse(safeFileName(name));
  if(!parsed.base||parsed.base==='.'||parsed.base==='..')throw new Error('Nome de arquivo inválido.');
  for(let i=0;i<10000;i++){
    const file=path.join(folder,parsed.name+(i?' ('+i+')':'')+parsed.ext);
    const key=file.toLowerCase();
    if(reservedPaths.has(key))continue;
    reservedPaths.add(key);
    try{await fsp.stat(file)}
    catch(error){
      if(error.code==='ENOENT')return {file,key};
      reservedPaths.delete(key);
      throw error;
    }
    reservedPaths.delete(key);
  }
  throw new Error('Não foi possível reservar um nome de arquivo.');
}
async function extractedFiles(folder){
  const files=[];
  async function visit(directory){
    for(const entry of await fsp.readdir(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile())files.push({relative:path.relative(folder,file),size:(await fsp.stat(file)).size});
    }
  }
  await visit(folder);
  return files;
}

async function localCopyExists(copy){
  if(!copy||typeof copy.path!=='string'||!path.isAbsolute(copy.path))return false;
  try{
    if(copy.files){
      const entries=copy.files;
      if(!Array.isArray(entries)||!entries.length)return false;
      for(const entry of entries){
        if(!entry.relative||path.isAbsolute(entry.relative)||entry.relative.split(/[\\/]/).includes('..'))return false;
        const actual=await fsp.stat(path.join(copy.path,entry.relative));
        if(!actual.isFile()||actual.size!==entry.size)return false;
      }
      return true;
    }
    const actual=await fsp.stat(copy.path);
    return actual.isFile()&&actual.size===copy.size;
  }catch{return false}
}

ipcMain.handle('check-local-copies',async(_event,copies)=>{
  if(!Array.isArray(copies))return [];
  const results=[];
  for(const copy of copies)results.push(await localCopyExists(copy));
  return results;
});
ipcMain.handle('download-extract',async(_event,{id,names,urls,jobId,directory})=>{
  const linked=Array.isArray(urls);
  if(!Array.isArray(names)||!names.length||
     (linked?(urls.length!==names.length||urls.some(url=>!publicHttps(url))):!(/^[a-z0-9._-]+$/i.test(id)))) {
    throw new Error('Conjunto de arquivos inválido.');
  }
  let folder;
  try{
    const chosen=jobId?{filePaths:[await downloadFolder(directory)]}:await dialog.showOpenDialog(mainWindow,{
      title:'Escolher onde salvar e extrair',properties:['openDirectory','createDirectory']
    });
    if(chosen.canceled||!chosen.filePaths.length)return{canceled:true};
    const filenames=names.map(safeFileName);
    if(filenames.some(name=>!name||name==='.'||name==='..'||/[. ]$/.test(name)) ||
       new Set(filenames.map(name=>name.toLowerCase())).size!==filenames.length){
      throw new Error('Os nomes dos volumes são incompatíveis com o Windows.');
    }
    folder=await fsp.mkdtemp(path.join(chosen.filePaths[0],'Meu Acervo - '));
    const volumes=path.join(folder,'Volumes');
    await fsp.mkdir(volumes);
    for(const [index,name] of names.entries()){
      const url=linked?urls[index]:'https://archive.org/download/'+encodeURIComponent(id)+'/'+name.split('/').map(encodeURIComponent).join('/');
      await downloadTo(url,path.join(volumes,filenames[index]),'extract-'+(index+1)+'/'+names.length,filenames[index],jobId);
    }
    const destination=path.join(folder,'Extraído');
    const staging=path.join(folder,'Extração em andamento');
    await fsp.mkdir(staging);
    send('transfer-progress',{jobId,phase:'extract',done:0,percent:null});
    const tool=app.isPackaged
      ?path.join(process.resourcesPath,'7zip','7z.exe')
      :path.join(__dirname,'vendor','7zip-full','7z.exe');
    await extractArchive(tool,path.join(volumes,filenames[0]),staging);
    await fsp.rename(staging,destination);
    lastExtractedFolder=destination;
    extractedFolders.add(destination);
    return{ok:true,path:destination,copy:{path:destination,files:await extractedFiles(destination)}};
  }catch(error){
    throw new Error(error.message+(folder?' Pasta da operação: '+folder:''));
  }
});

ipcMain.handle('read-github-catalog',async(_event,input)=>{
  const url=githubCatalogUrl(input);
  if(!url)throw new Error('Informe um link válido para o JSON no GitHub.');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('O GitHub respondeu com HTTP '+response.status+'. Confira se o arquivo é público.');
  const limit=16*1024*1024;
  const chunks=[];
  let size=0;
  if(!response.body)throw new Error('O GitHub devolveu um arquivo vazio.');
  for await(const chunk of response.body){
    size+=chunk.length;
    if(size>limit)throw new Error('O catálogo JSON ultrapassa 16 MB.');
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''))}
  catch{throw new Error('O arquivo do GitHub não contém JSON válido.')}
});
function validateFtp(config){
  if(!config?.host)throw new Error('Informe o IP do PS4.');
  return{host:String(config.host),port:Number(config.port)||2121,user:String(config.user||'anonymous'),password:String(config.password||''),secure:Boolean(config.secure)};
}
async function connectFtp(config){
  const client=new ftp.Client(20000);
  client.ftp.verbose=false;
  try{await client.access(validateFtp(config));return client}
  catch(error){client.close();throw error}
}

registerFtpExplorer({ipcMain,dialog,getWindow:()=>mainWindow,connect:connectFtp,send});

ipcMain.handle('ftp-test',async(_e,config)=>{
  const client=await connectFtp(config);
  try{return{ok:true,message:'PS4 conectado com sucesso.'}}finally{client.close()}
});

ipcMain.handle('download-file',async(_e,{url,name,jobId,directory})=>{
  if(jobId){
    const {file,key}=await reserveDownloadPath(await downloadFolder(directory),name);
    try{
      await downloadTo(url,file,'pc',name,jobId);
      return {ok:true,path:file,copy:{path:file,size:(await fsp.stat(file)).size}};
    }finally{reservedPaths.delete(key)}
  }
  const chosen=await dialog.showSaveDialog(mainWindow,{title:'Salvar no computador',defaultPath:safeFileName(name)});
  if(chosen.canceled||!chosen.filePath)return{canceled:true};
  const operation=`pc-${Date.now()}`;
  await downloadTo(url,chosen.filePath,operation,name);
  return{ok:true,path:chosen.filePath,copy:{path:chosen.filePath,size:(await fsp.stat(chosen.filePath)).size}};
});

ipcMain.handle('send-to-ps4',async(_e,{url,name,config,jobId})=>{
  const operation=`ps4-${Date.now()}`;
  const tempDir=await fsp.mkdtemp(path.join(os.tmpdir(),'meu-acervo-'));
  const tempFile=path.join(tempDir,safeFileName(name));
  let client;
  try{
    await downloadTo(url,tempFile,operation,name,jobId);
    client=await connectFtp(config);
    const remoteBase=String(config.remotePath||'/data/pkg').replace(/\\/g,'/');
    await client.ensureDir(remoteBase);
    const total=(await fsp.stat(tempFile)).size;let uploaded=0;
    client.trackProgress(info=>{uploaded=info.bytesOverall;send('transfer-progress',{jobId,operation,phase:'upload',done:uploaded,total,percent:total?Math.min(100,Math.round(uploaded/total*100)):null})});
    await client.uploadFrom(tempFile,safeFileName(name));
    client.trackProgress();
    return{ok:true,remotePath:`${remoteBase.replace(/\/$/,'')}/${safeFileName(name)}`};
  }finally{
    if(client)client.close();
    await fsp.rm(tempDir,{recursive:true,force:true}).catch(()=>{});
  }
});

let uploadingExtracted=false;
ipcMain.handle('send-extracted-to-ps4',async(_event,config,options={})=>{
  const selectedFolder=options.path||lastExtractedFolder;
  if(!selectedFolder||!extractedFolders.has(selectedFolder))throw new Error('Extraia um arquivo no PC antes de enviar.');
  if(uploadingExtracted)throw new Error('Já existe um envio em andamento.');
  uploadingExtracted=true;
  let client;
  try{
    const folder=await fsp.realpath(selectedFolder);
    const chosen=await dialog.showOpenDialog(mainWindow,{
      title:'Escolher arquivos extraídos para enviar ao PS4',
      defaultPath:folder,properties:['openFile','multiSelections']
    });
    if(chosen.canceled||!chosen.filePaths.length)return {canceled:true};
    const files=[];
    for(const file of chosen.filePaths){
      const actual=await fsp.realpath(file);
      const relative=path.relative(folder,actual);
      if(!relative||path.isAbsolute(relative)||relative.split(path.sep)[0]==='..'){
        throw new Error('Escolha arquivos dentro da pasta extraída.');
      }
      const stat=await fsp.stat(actual);
      if(!stat.isFile())throw new Error('Selecione arquivos válidos para enviar.');
      files.push({path:actual,name:path.basename(actual),size:stat.size});
    }
    if(new Set(files.map(file=>file.name.toLowerCase())).size!==files.length){
      throw new Error('Selecione arquivos com nomes diferentes.');
    }
    client=await connectFtp(config);
    const remoteBase=String(config.remotePath||'/data/pkg').replace(/\\/g,'/');
    await client.ensureDir(remoteBase);
    const total=files.reduce((sum,file)=>sum+file.size,0);
    client.trackProgress(info=>send('transfer-progress',{
      jobId:options.jobId,phase:'upload',done:info.bytesOverall,total,
      percent:total?Math.min(100,Math.round(info.bytesOverall/total*100)):null
    }));
    for(const file of files)await client.uploadFrom(file.path,file.name);
    return {ok:true,count:files.length,remotePath:remoteBase};
  }finally{
    if(client)client.close();
    uploadingExtracted=false;
  }
});

async function exportJson(data,title,defaultPath){
  const chosen=await dialog.showSaveDialog(mainWindow,{title,defaultPath,filters:[{name:'Catálogo JSON',extensions:['json']}]});
  if(chosen.canceled||!chosen.filePath)return{canceled:true};
  await fsp.writeFile(chosen.filePath,JSON.stringify(data,null,2),'utf8');
  return{ok:true,path:chosen.filePath};
}
ipcMain.handle('export-catalog',(_e,data)=>exportJson(data,'Exportar catálogo','meu-acervo-catalogo.json'));
ipcMain.handle('export-ps4-catalog',(_e,data)=>exportJson(data,'Exportar lista PKG do PS4','meu-acervo-ps4.json'));

ipcMain.handle('open-external',(_e,url)=>{
  const destination=publicHttps(url);
  if(destination)return shell.openExternal(destination);
});

ipcMain.handle('game-metadata',async(_event,{key,title,ps4})=>{
  if(key){
    try{
      const games=await lookupTheGamesDb(key,title,ps4);
      if(games.some(game=>game.cover))return games;
    }catch{
      // Keep cover synchronization available if the provider rejects the key.
    }
  }
  return lookupWikiGames(title);
});

async function lookupTheGamesDb(key,title,ps4){
  const query=new URLSearchParams({apikey:key,name:title,include:'boxart,platform',fields:'overview,platform'});
  if(ps4)query.set('filter[platform]','4919');
  let response;
  try{
    response=await fetch('https://api.thegamesdb.net/v1/Games/ByGameName?'+query,{
      redirect:'error',signal:AbortSignal.timeout(15000)
    });
  }catch{throw new Error('O TheGamesDB está indisponível. Tente novamente.')}
  if(!response.ok)throw new Error(response.status===403||response.status===429
    ?'Confira a chave ou o limite de consultas do TheGamesDB.'
    :'O TheGamesDB respondeu com HTTP '+response.status+'.');
  const result=await response.json();
  const images=result.include?.boxart;
  const base=images?.base_url?.medium||images?.base_url?.original;
  return (result.data?.games||[]).map(game=>{
    const art=(images?.data?.[game.id]||[]).find(image=>image.side==='front');
    const secureBase=base?.replace(/^http:/,'https:');
    const cover=secureBase&&art?.filename?new URL(art.filename,secureBase).href:'';
    return {
      id:game.id,title:game.game_title,description:game.overview||'',date:game.release_date||'',
      platform:result.include?.platform?.data?.[game.platform]?.name||'Plataforma '+game.platform,
      cover:cover.startsWith('https://')?cover:''
    };
  });
}

