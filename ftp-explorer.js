const path=require('node:path');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');

function remotePath(input){
  if(typeof input!=='string'||!input.startsWith('/')||/[\u0000-\u001f\\]/.test(input)){
    throw new Error('Informe um caminho absoluto do PS4, como /data/pkg.');
  }
  return path.posix.normalize(input).replace(/\/+$/,'')||'/';
}

function remoteName(input){
  if(typeof input!=='string'||!input.trim()||input==='.'||input==='..'||/[/\\\u0000-\u001f]/.test(input)){
    throw new Error('Informe um nome válido sem barras.');
  }
  return input;
}

function entriesFrom(list){
  return list.filter(entry=>entry.name!=='.'&&entry.name!=='..').map(entry=>({
    name:entry.name,type:entry.isDirectory?'folder':entry.isFile?'file':'other',
    size:entry.size||0,modifiedAt:entry.modifiedAt?.toISOString?.()||null
  }));
}

function registerFtpExplorer({ipcMain,dialog,getWindow,connect,send}){
  async function withClient(config,action){
    const client=await connect(config);
    try{return await action(client)}finally{client.close()}
  }

  async function listed(client,folder){
    return entriesFrom(await client.list(folder));
  }

  async function existing(client,folder,name){
    const entry=(await listed(client,folder)).find(item=>item.name===name);
    if(!entry)throw new Error('O item mudou ou não está mais nessa pasta.');
    if(entry.type==='other')throw new Error('Esse tipo de item não pode ser alterado pelo explorador.');
    return entry;
  }

  ipcMain.handle('ftp-explore-list',(_event,{config,folder})=>
    withClient(config,async client=>{
      const directory=remotePath(folder);
      return {folder:directory,entries:await listed(client,directory)};
    }));

  ipcMain.handle('ftp-explore-edit',(_event,{config,folder,action,name,nextName,destination})=>
    withClient(config,async client=>{
      const parent=remotePath(folder);
      const old=remoteName(name);
      const absolute=path.posix.join(parent,old);
      if(action==='mkdir'){
        await client.send('MKD '+absolute);
      }else if(action==='rename'||action==='move'){
        await existing(client,parent,old);
        const next=action==='rename'?remoteName(nextName):old;
        const targetFolder=action==='move'?remotePath(destination):parent;
        const target=path.posix.join(targetFolder,next);
        if(absolute===target)return {ok:true};
        if(targetFolder===absolute||targetFolder.startsWith(absolute+'/')){
          throw new Error('Escolha uma pasta fora do próprio item.');
        }
        if((await listed(client,targetFolder)).some(entry=>entry.name===next)){
          throw new Error('Já existe um item com esse nome no destino.');
        }
        await client.rename(absolute,target);
      }else if(action==='remove'){
        const entry=await existing(client,parent,old);
        const notice=await dialog.showMessageBox(getWindow(),{
          type:'warning',buttons:['Cancelar','Excluir'],defaultId:0,cancelId:0,
          message:'Excluir este item do PS4?',detail:absolute
        });
        if(notice.response!==1)return {canceled:true};
        if(entry.type==='folder')await client.removeEmptyDir(absolute);
        else await client.remove(absolute);
      }else throw new Error('Operação FTP desconhecida.');
      return {ok:true};
    }));

  function track(client,phase,total,jobId){
    client.trackProgress(info=>send('transfer-progress',{
      jobId,phase,local:true,done:total?Math.min(info.bytesOverall,total):info.bytesOverall,total,
      percent:total?Math.min(100,info.bytesOverall/total*100):null
    }));
  }

  ipcMain.handle('ftp-explore-upload',async(_event,{config,folder,jobId})=>{
    const directory=remotePath(folder);
    const selected=await dialog.showOpenDialog(getWindow(),{
      title:'Escolher backups ou arquivos locais',properties:['openFile','multiSelections']
    });
    if(selected.canceled||!selected.filePaths.length)return {canceled:true};
    return withClient(config,async client=>{
      const taken=new Set((await listed(client,directory)).map(entry=>entry.name));
      const files=[];
      let skipped=0;
      for(const file of selected.filePaths){
        const name=remoteName(path.basename(file));
        if(taken.has(name)){skipped++;continue}
        taken.add(name);
        files.push({file,name,size:(await fs.promises.stat(file)).size});
      }
      track(client,'upload',files.reduce((total,file)=>total+file.size,0),jobId);
      let uploaded=0;
      for(const file of files){
        const target=path.posix.join(directory,file.name);
        const partial=path.posix.join(directory,'.lumi-'+randomUUID()+'.part');
        try{
          await client.uploadFrom(file.file,partial);
          if((await listed(client,directory)).some(entry=>entry.name===file.name)){
            await client.remove(partial);
            skipped++;
            continue;
          }
          await client.rename(partial,target);
          uploaded++;
        }catch(error){
          if(!client.closed)await client.remove(partial,true).catch(()=>{});
          throw new Error(uploaded+' arquivo(s) enviado(s) antes da falha. '+error.message);
        }
      }
      return {ok:true,uploaded,skipped,folder:directory};
    });
  });

  ipcMain.handle('ftp-explore-download',async(_event,{config,folder,name,jobId})=>{
    const directory=remotePath(folder);
    const file=remoteName(name);
    const selected=await dialog.showSaveDialog(getWindow(),{
      title:'Salvar arquivo do PS4',defaultPath:file.replace(/[<>:"|?*]/g,'_')
    });
    if(selected.canceled||!selected.filePath)return {canceled:true};
    return withClient(config,async client=>{
      const entry=await existing(client,directory,file);
      if(entry.type!=='file')throw new Error('Escolha um arquivo para salvar no PC.');
      const partial=path.join(path.dirname(selected.filePath),'.lumi-'+randomUUID()+'.part');
      try{
        track(client,'ftp-download',entry.size,jobId);
        await client.downloadTo(partial,path.posix.join(directory,file));
        await fs.promises.rename(partial,selected.filePath);
        return {ok:true,path:selected.filePath};
      }finally{await fs.promises.unlink(partial).catch(()=>{})}
    });
  });
}

module.exports={registerFtpExplorer,remotePath,remoteName};

