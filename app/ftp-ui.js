// Explorador FTP do PS4. Depende de globais de app.js: $, loadFtp, getFtpForm, populateFtp, setFtpStatus, FTP_KEY, ftpDialog, showToast.
(function(){
  'use strict';
  const FALLBACK_FOLDER='/data/pkg';
  const dlg=$('#ftpExplorer');
  const ui={
    up:$('#explorerUp'),refresh:$('#explorerRefresh'),jump:$('#explorerDefaultJump'),
    addrForm:$('#explorerAddressForm'),addr:$('#explorerAddress'),tree:$('#explorerTree'),
    upload:$('#explorerUpload'),download:$('#explorerDownload'),mkdir:$('#explorerMkdir'),
    rename:$('#explorerRename'),move:$('#explorerMove'),remove:$('#explorerRemove'),
    editForm:$('#explorerEditForm'),editLabel:$('#explorerEditLabel'),editValue:$('#explorerEditValue'),
    editCancel:$('#explorerEditCancel'),status:$('#explorerStatus'),entries:$('#explorerEntries'),
    settings:$('#explorerSettings'),close:$('#explorerClose'),defaultLabel:$('#explorerDefault')
  };
  const st={config:null,current:'/',entries:[],selected:null,busy:false,loading:false,navToken:0,job:null,editMode:null,nodes:new Map(),lastError:''};

  /* ---------- helpers ---------- */
  function cleanError(error){
    const raw=(error&&error.message)||String(error||'Erro desconhecido.');
    return raw.replace(/^Error invoking remote method '[^']*':\s*/,'').replace(/^(\w*Error):\s*/,'').trim()||'Erro desconhecido.';
  }
  function normalize(value){
    const parts=[];
    for(const part of String(value||'').trim().replace(/\\/g,'/').split('/')){
      if(!part||part==='.')continue;
      if(part==='..')parts.pop();else parts.push(part);
    }
    return '/'+parts.join('/');
  }
  function isAbsolute(value){return String(value||'').trim().replace(/\\/g,'/').startsWith('/')}
  function parentOf(path){const i=path.lastIndexOf('/');return i<=0?'/':path.slice(0,i)}
  function joinPath(base,name){return base==='/'?'/'+name:base+'/'+name}
  function ancestorsOf(path){const list=['/'];let acc='';for(const part of path.split('/').filter(Boolean)){acc+='/'+part;list.push(acc)}return list}
  function bytes(n){
    n=Number(n);if(!isFinite(n)||n<0)return '—';
    const units=['B','KB','MB','GB','TB'];let i=0;
    while(n>=1024&&i<units.length-1){n/=1024;i++}
    return (i?n.toFixed(i>1?1:0):String(Math.round(n)))+' '+units[i];
  }
  function formatDate(value){
    if(!value)return '—';
    const d=new Date(value);
    return isNaN(d)?'—':d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  }
  function savedConfig(){return typeof loadFtp==='function'?loadFtp():{}}
  function defaultFolder(){return normalize(savedConfig().remotePath||FALLBACK_FOLDER)}
  function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  function setStatus(text,kind){
    ui.status.textContent=text||'';
    ui.status.dataset.kind=kind||'';
  }
  function selectedEntry(){return st.entries.find(e=>e.name===st.selected)||null}
  function newJobId(){return 'ftp-'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2))}

  /* ---------- tree ---------- */
  function node(path){
    let n=st.nodes.get(path);
    if(!n){n={path,children:null,expanded:false,loading:false,error:false};st.nodes.set(path,n)}
    return n;
  }
  function setChildrenFromEntries(path,entries){
    const n=node(path);
    n.children=entries.filter(e=>e.type==='folder').map(e=>e.name).sort(collator);
    n.error=false;
  }
  function collator(a,b){return a.localeCompare(b,'pt-BR',{numeric:true,sensitivity:'base'})}
  async function loadChildren(path){
    const n=node(path);
    if(n.loading||n.children)return;
    n.loading=true;n.error=false;renderTree();
    try{
      const result=await window.desktop.ftpList(st.config,path);
      setChildrenFromEntries(path,result.entries||[]);
    }catch(error){n.error=true}
    n.loading=false;renderTree();
  }
  function toggleNode(path){
    const n=node(path);
    n.expanded=!n.expanded;
    renderTree();
    if(n.expanded&&!n.children)loadChildren(path);
  }
  function invalidate(path){
    const n=st.nodes.get(path);
    if(n){n.children=null;n.error=false}
  }
  function renderTree(){
    const hadFocus=ui.tree.contains(document.activeElement);
    const focusedPath=hadFocus?document.activeElement.dataset.path:null;
    ui.tree.replaceChildren();
    ui.tree.setAttribute('role','tree');
    ui.tree.setAttribute('aria-label','Pastas do PS4');
    ui.tree.appendChild(buildNode('/',1));
    if(focusedPath){const again=ui.tree.querySelector('[data-path="'+CSS.escape(focusedPath)+'"]');if(again)again.focus()}
  }
  function buildNode(path,level){
    const n=node(path);
    const li=el('div','tree-node');
    li.setAttribute('role','none');
    const row=el('div','tree-row'+(path===st.current?' current':''));
    row.setAttribute('role','treeitem');
    row.setAttribute('aria-level',String(level));
    row.setAttribute('aria-selected',String(path===st.current));
    row.dataset.path=path;
    row.tabIndex=path===st.current?0:-1;
    const hasKids=!n.children||n.children.length>0;
    if(hasKids)row.setAttribute('aria-expanded',String(n.expanded));
    const twisty=el('button','tree-twisty',n.loading?'…':hasKids?(n.expanded?'▾':'▸'):'');
    twisty.type='button';twisty.tabIndex=-1;twisty.setAttribute('aria-hidden','true');
    twisty.addEventListener('click',e=>{e.stopPropagation();if(hasKids&&!st.busy)toggleNode(path)});
    const label=el('span','tree-label',path==='/'?'/ (raiz)':path.split('/').pop());
    row.append(twisty,label);
    if(n.loading){row.classList.add('loading');row.setAttribute('aria-busy','true')}
    if(n.error){row.classList.add('error');row.title='Não foi possível carregar as subpastas.'}
    row.addEventListener('click',()=>{if(!st.busy)navigate(path)});
    row.addEventListener('keydown',e=>treeKey(e,path,n,hasKids));
    li.appendChild(row);
    if(n.expanded&&n.children&&n.children.length){
      const group=el('div','tree-children');
      group.setAttribute('role','group');
      for(const name of n.children)group.appendChild(buildNode(joinPath(path,name),level+1));
      li.appendChild(group);
    }
    return li;
  }
  function treeKey(e,path,n,hasKids){
    if(st.busy)return;
    const rows=[...ui.tree.querySelectorAll('.tree-row')];
    const i=rows.indexOf(e.currentTarget);
    let handled=true;
    if(e.key==='ArrowDown'){if(rows[i+1])rows[i+1].focus()}
    else if(e.key==='ArrowUp'){if(rows[i-1])rows[i-1].focus()}
    else if(e.key==='ArrowRight'){if(hasKids&&!n.expanded)toggleNode(path);else if(rows[i+1]&&n.expanded)rows[i+1].focus()}
    else if(e.key==='ArrowLeft'){if(n.expanded)toggleNode(path);else if(path!=='/'){const p=ui.tree.querySelector('[data-path="'+CSS.escape(parentOf(path))+'"]');if(p)p.focus()}}
    else if(e.key==='Enter'||e.key===' '){navigate(path)}
    else handled=false;
    if(handled)e.preventDefault();
  }
  async function expandAncestors(path,token){
    for(const p of ancestorsOf(path)){
      node(p).expanded=true;
    }
    renderTree();
    for(const p of ancestorsOf(path)){
      if(token!==st.navToken)return;
      if(p!==path&&!node(p).children)await loadChildren(p);
    }
  }

  /* ---------- entries list ---------- */
  function sortEntries(list){
    return list.slice().sort((a,b)=>{
      const fa=a.type==='folder'?0:1,fb=b.type==='folder'?0:1;
      return fa-fb||collator(a.name,b.name);
    });
  }
  function entryId(index){return 'explorerEntry'+index}
  function renderEntries(){
    ui.entries.replaceChildren();
    ui.entries.setAttribute('role','listbox');
    ui.entries.setAttribute('aria-label','Conteúdo da pasta '+st.current);
    ui.entries.tabIndex=0;
    ui.entries.setAttribute('aria-busy',String(st.loading));
    if(st.loading){ui.entries.appendChild(el('p','explorer-empty','Carregando…'));ui.entries.removeAttribute('aria-activedescendant');return}
    if(!st.entries.length){ui.entries.appendChild(el('p','explorer-empty','Esta pasta está vazia.'));ui.entries.removeAttribute('aria-activedescendant');return}
    const head=el('div','entry-row entry-head');
    head.setAttribute('aria-hidden','true');
    head.append(el('span','entry-name','Nome'),el('span','entry-size','Tamanho'),el('span','entry-date','Modificado'));
    ui.entries.appendChild(head);
    st.entries.forEach((entry,index)=>{
      const row=el('div','entry-row '+entry.type+(entry.name===st.selected?' selected':''));
      row.id=entryId(index);
      row.setAttribute('role','option');
      row.setAttribute('aria-selected',String(entry.name===st.selected));
      row.dataset.name=entry.name;
      const kind=entry.type==='folder'?'Pasta':entry.type==='file'?'Arquivo':'Item';
      row.setAttribute('aria-label',kind+' '+entry.name+(entry.type==='file'?', '+bytes(entry.size):''));
      const name=el('span','entry-name');
      name.append(el('span','entry-icon',entry.type==='folder'?'📁':entry.type==='file'?'📄':'❔'),el('span','entry-text',entry.name));
      name.title=entry.name;
      row.append(name,el('span','entry-size',entry.type==='file'?bytes(entry.size):'—'),el('span','entry-date',formatDate(entry.modifiedAt)));
      row.addEventListener('click',()=>{if(!st.busy){select(entry.name);ui.entries.focus()}});
      row.addEventListener('dblclick',()=>{if(!st.busy)openEntry(entry)});
      ui.entries.appendChild(row);
    });
    const index=st.entries.findIndex(e=>e.name===st.selected);
    if(index>=0)ui.entries.setAttribute('aria-activedescendant',entryId(index));else ui.entries.removeAttribute('aria-activedescendant');
  }
  function select(name){
    st.selected=name;
    renderEntries();
    const index=st.entries.findIndex(e=>e.name===name);
    const row=index>=0&&document.getElementById(entryId(index));
    if(row)row.scrollIntoView({block:'nearest'});
    updateControls();
  }
  function openEntry(entry){
    if(entry&&entry.type==='folder')navigate(joinPath(st.current,entry.name));
  }
  ui.entries.addEventListener('keydown',e=>{
    if(st.busy||!st.entries.length)return;
    const i=st.entries.findIndex(x=>x.name===st.selected);
    let next=null;
    if(e.key==='ArrowDown')next=Math.min(st.entries.length-1,i+1);
    else if(e.key==='ArrowUp')next=Math.max(0,i<0?0:i-1);
    else if(e.key==='Home')next=0;
    else if(e.key==='End')next=st.entries.length-1;
    else if(e.key==='Enter'){const entry=selectedEntry();if(entry){e.preventDefault();openEntry(entry)}return}
    else if(e.key==='Backspace'){e.preventDefault();goUp();return}
    else if(e.key==='Delete'){if(selectedEntry()){e.preventDefault();removeSelected()}return}
    else if(e.key==='F2'){if(selectedEntry()){e.preventDefault();startEdit('rename')}return}
    else return;
    e.preventDefault();
    select(st.entries[next].name);
  });

  /* ---------- controls ---------- */
  function updateControls(){
    const entry=selectedEntry();
    const free=!st.busy&&!st.loading;
    ui.up.disabled=!free||st.current==='/';
    ui.refresh.disabled=!free;
    ui.jump.disabled=!free;
    ui.addr.disabled=st.busy;
    ui.addrForm.querySelector('button').disabled=st.busy;
    ui.upload.disabled=!free;
    ui.mkdir.disabled=!free;
    ui.download.disabled=!free||!entry||entry.type!=='file';
    ui.rename.disabled=!free||!entry;
    ui.move.disabled=!free||!entry;
    ui.remove.disabled=!free||!entry;
    ui.editValue.disabled=st.busy;
    for(const b of ui.editForm.querySelectorAll('button'))b.disabled=st.busy;
    ui.settings.disabled=st.busy;
    ui.close.disabled=st.busy;
    ui.entries.classList.toggle('busy',st.busy||st.loading);
  }
  function setBusy(value){st.busy=value;updateControls();renderTree()}

  /* ---------- navigation ---------- */
  async function navigate(path,options){
    options=options||{};
    path=normalize(path);
    cancelEdit(true);
    const token=++st.navToken;
    st.loading=true;
    ui.addr.value=path;
    setStatus('Abrindo '+path+'…');
    renderEntries();updateControls();
    try{
      const result=await window.desktop.ftpList(st.config,path);
      if(token!==st.navToken)return false;
      const folder=normalize(result.folder||path);
      st.current=folder;
      st.entries=sortEntries(result.entries||[]);
      if(!options.keepSelection||!st.entries.some(e=>e.name===st.selected))st.selected=options.select&&st.entries.some(e=>e.name===options.select)?options.select:null;
      st.loading=false;
      setChildrenFromEntries(folder,st.entries);
      ui.addr.value=folder;
      const folders=st.entries.filter(e=>e.type==='folder').length,files=st.entries.length-folders;
      setStatus(options.message||(folder+' · '+folders+(folders===1?' pasta':' pastas')+', '+files+(files===1?' arquivo':' arquivos')),options.kind||'');
      renderEntries();updateControls();
      expandAncestors(folder,token);
      return true;
    }catch(error){
      if(token!==st.navToken)return false;
      st.loading=false;
      if(options.fallback&&path!=='/'){
        const message='Não foi possível abrir '+path+' ('+cleanError(error)+'). Mostrando a raiz /.';
        await navigate('/',{message,kind:'error'});
        return false;
      }
      setStatus('Erro ao abrir '+path+': '+cleanError(error),'error');
      ui.addr.value=st.current;
      renderEntries();updateControls();
      return false;
    }
  }
  function goUp(){if(st.current!=='/'&&!st.busy&&!st.loading)navigate(parentOf(st.current))}
  function refresh(extra){return navigate(st.current,Object.assign({keepSelection:true},extra))}

  /* ---------- operations ---------- */
  async function runOperation(label,work,options){
    options=options||{};
    setBusy(true);
    setStatus(label+'…');
    let outcome=null,ok=false;
    try{
      outcome=await work();
      ok=true;
    }catch(error){
      setBusy(false);
      st.job=null;
      await refresh({message:label+' falhou: '+cleanError(error),kind:'error'});
      return null;
    }
    st.job=null;
    setBusy(false);
    if(outcome&&outcome.canceled){setStatus('Operação cancelada.');updateControls();return outcome}
    for(const p of options.invalidate||[])invalidate(p);
    await refresh({message:options.success?options.success(outcome):'Concluído.',kind:'ok',select:options.select});
    return ok?outcome:null;
  }
  function onProgress(event){
    if(!event||!st.job||event.jobId!==st.job.id)return;
    const percent=Number.isFinite(event.percent)?Math.round(event.percent):(event.total?Math.round(event.done/event.total*100):0);
    setStatus(st.job.label+' '+percent+'% ('+bytes(event.done)+' de '+bytes(event.total)+')');
  }
  function startJob(label){st.job={id:newJobId(),label};return st.job.id}

  function startEdit(mode){
    const entry=selectedEntry();
    if(st.busy||st.loading)return;
    if(mode!=='mkdir'&&!entry)return;
    st.editMode=mode;
    ui.editForm.hidden=false;
    if(mode==='mkdir'){ui.editLabel.textContent='Nome da nova pasta';ui.editValue.value=''}
    else if(mode==='rename'){ui.editLabel.textContent='Novo nome para "'+entry.name+'"';ui.editValue.value=entry.name}
    else{ui.editLabel.textContent='Mover "'+entry.name+'" para a pasta (caminho absoluto)';ui.editValue.value=st.current}
    ui.editValue.focus();
    if(mode==='rename'){const dot=entry.type==='file'?entry.name.lastIndexOf('.'):-1;ui.editValue.setSelectionRange(0,dot>0?dot:entry.name.length)}
    else ui.editValue.select();
  }
  function cancelEdit(silent){
    st.editMode=null;ui.editForm.hidden=true;ui.editValue.value='';
    if(!silent&&!ui.mkdir.disabled)ui.entries.focus();
  }
  async function submitEdit(event){
    event.preventDefault();
    if(st.busy||!st.editMode)return;
    const mode=st.editMode,entry=selectedEntry(),value=ui.editValue.value.trim();
    if(!value){setStatus('Informe um valor.','error');return}
    const folder=st.current;
    if(mode==='mkdir'||mode==='rename'){
      if(value.includes('/')||value==='.'||value==='..'){setStatus('O nome não pode conter "/" nem ser "." ou "..".','error');return}
    }
    if(mode==='mkdir'){
      cancelEdit(true);
      await runOperation('Criando pasta',()=>window.desktop.ftpEdit(st.config,{folder,action:'mkdir',name:value}),
        {invalidate:[folder],select:value,success:()=>'Pasta "'+value+'" criada.'});
    }else if(mode==='rename'&&entry){
      if(value===entry.name){cancelEdit();return}
      cancelEdit(true);
      await runOperation('Renomeando',()=>window.desktop.ftpEdit(st.config,{folder,action:'rename',name:entry.name,nextName:value}),
        {invalidate:[folder],select:value,success:()=>'"'+entry.name+'" renomeado para "'+value+'".'});
    }else if(mode==='move'&&entry){
      if(!isAbsolute(value)){setStatus('Informe um caminho absoluto, começando com "/".','error');return}
      const destination=normalize(value);
      if(destination===folder){setStatus('O item já está nesta pasta.','error');return}
      if(entry.type==='folder'){
        const own=joinPath(folder,entry.name);
        if(destination===own||destination.startsWith(own+'/')){setStatus('Não é possível mover uma pasta para dentro dela mesma.','error');return}
      }
      cancelEdit(true);
      await runOperation('Movendo',()=>window.desktop.ftpEdit(st.config,{folder,action:'move',name:entry.name,destination}),
        {invalidate:[folder,destination],success:()=>'"'+entry.name+'" movido para '+destination+'.'});
    }
  }
  async function removeSelected(){
    const entry=selectedEntry();
    if(!entry||st.busy||st.loading)return;
    const folder=st.current;
    cancelEdit(true);
    st.selected=null;
    await runOperation('Excluindo',()=>window.desktop.ftpEdit(st.config,{folder,action:'remove',name:entry.name}),
      {invalidate:[folder],success:()=>'"'+entry.name+'" excluído.'});
  }
  async function uploadFiles(){
    if(st.busy||st.loading)return;
    cancelEdit(true);
    const folder=st.current;
    const jobId=startJob('Enviando');
    const result=await runOperation('Enviando arquivos',()=>window.desktop.ftpUploadLocal(st.config,folder,jobId),
      {invalidate:[folder],success:r=>{
        const sent=Number(r&&r.uploaded)||0,skipped=Number(r&&r.skipped)||0;
        return sent+(sent===1?' arquivo enviado':' arquivos enviados')+(skipped?' · '+skipped+(skipped===1?' ignorado':' ignorados'):'')+'.';
      }});
    return result;
  }
  async function downloadSelected(){
    const entry=selectedEntry();
    if(!entry||entry.type!=='file'||st.busy||st.loading)return;
    cancelEdit(true);
    const folder=st.current;
    const jobId=startJob('Baixando');
    await runOperation('Baixando "'+entry.name+'"',()=>window.desktop.ftpDownloadLocal(st.config,folder,entry.name,jobId),
      {success:r=>'Arquivo salvo em '+(r&&r.path?r.path:'seu computador')+'.'});
  }

  /* ---------- open / close ---------- */
  async function openExplorer(config){
    st.config=config;
    st.nodes=new Map();
    st.entries=[];st.selected=null;st.current='/';st.job=null;st.busy=false;st.loading=false;
    node('/').expanded=true;
    cancelEdit(true);
    ui.defaultLabel.textContent='Pasta padrão: '+normalize(config.remotePath||FALLBACK_FOLDER);
    if(!dlg.open)dlg.showModal();
    renderTree();
    const start=normalize(config.remotePath||FALLBACK_FOLDER);
    await navigate(start,{fallback:true});
    ui.entries.focus();
  }
  $('#browseFtp').addEventListener('click',function(event){
    event.preventDefault();
    const config=getFtpForm();
    if(!config.host){setFtpStatus('Informe o IP do PS4.',false);return}
    localStorage.setItem(FTP_KEY,JSON.stringify(config));
    populateFtp();
    ftpDialog.close();
    openExplorer(loadFtp());
  });
  ui.up.addEventListener('click',goUp);
  ui.refresh.addEventListener('click',()=>{if(!st.busy){invalidate(st.current);refresh()}});
  ui.jump.addEventListener('click',()=>{if(!st.busy)navigate(defaultFolder(),{fallback:true})});
  ui.addrForm.addEventListener('submit',event=>{
    event.preventDefault();
    if(st.busy)return;
    const value=ui.addr.value.trim();
    if(!isAbsolute(value)){setStatus('Digite um caminho absoluto, começando com "/".','error');return}
    navigate(value);
  });
  ui.mkdir.addEventListener('click',()=>startEdit('mkdir'));
  ui.rename.addEventListener('click',()=>startEdit('rename'));
  ui.move.addEventListener('click',()=>startEdit('move'));
  ui.remove.addEventListener('click',removeSelected);
  ui.upload.addEventListener('click',uploadFiles);
  ui.download.addEventListener('click',downloadSelected);
  ui.editForm.addEventListener('submit',submitEdit);
  ui.editCancel.addEventListener('click',()=>cancelEdit());
  ui.editValue.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancelEdit()}});
  ui.settings.addEventListener('click',()=>{
    if(st.busy)return;
    dlg.close();
    populateFtp();setFtpStatus('',true);
    ftpDialog.showModal();
  });
  ui.close.addEventListener('click',()=>{if(!st.busy)dlg.close()});
  dlg.addEventListener('cancel',event=>{if(st.busy)event.preventDefault()});
  dlg.addEventListener('close',()=>{st.navToken++;st.loading=false;st.config=null;cancelEdit(true)});
  if(window.desktop&&window.desktop.onProgress)window.desktop.onProgress(onProgress);
})();

