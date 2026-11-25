const settingsDialog=$('#settingsDialog');
const metadataDialog=$('#metadataDialog');
const settingsKey='meu-acervo-settings';
let preferences={};
try{preferences=JSON.parse(localStorage.getItem(settingsKey))||{}}catch{}

function savePreferences(){
  localStorage.setItem(settingsKey,JSON.stringify(preferences));
}

function normalizeSearch(value){
  return String(value||'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
}

function matchTitle(value){
  return normalizeSearch(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

function hasMultipart(item){
  return (item.files||[]).some(file=>/\.part\d+\.rar$|\.(?:7z|zip)\.\d{3,}$|\.r\d{2,}$/i.test(file.name));
}

const category=$('#catalogCategory'), order=$('#catalogOrder'), multipart=$('#multipartOnly');
filteredItems=function(){
  const terms=normalizeSearch(state.query).split(/\s+/).filter(Boolean);
  const items=state.items.filter(item=>{
    const searchable=normalizeSearch([item.title,item.providerTitle,item.creator,item.serial].join(' '));
    return (state.filter==='todos'||item.type===state.filter) &&
      (!multipart.checked||hasMultipart(item)) && terms.every(word=>searchable.includes(word));
  });
  const compare=(a,b)=>a.title.localeCompare(b.title,'pt-BR',{sensitivity:'base',numeric:true});
  if(order.value==='az')items.sort(compare);
  if(order.value==='za')items.sort((a,b)=>compare(b,a));
  if(order.value==='size')items.sort((a,b)=>b.totalSize-a.totalSize);
  return items;
};

const renderCatalog=render;
render=function(){
  renderCatalog();
  category.value=state.filter;
  $('#noResults').hidden=!state.items.length||el.grid.childElementCount>0;
  document.body.classList.toggle('has-catalog',state.items.length>0);
  const itemsById=new Map(state.items.map(item=>[item.id,item]));
  for(const card of $$('.media-card',el.grid))ensureCover($('.card-cover',card),itemsById.get(card.dataset.id));
};

function ensureCover(image,item){
  if(!image||!item)return;
  const fallback=()=>retroCover(item.title,item.serial||typeLabel(item.type),0);
  image.addEventListener('error',()=>{image.src=fallback()},{once:true});
  if(!item.cover||(image.complete&&!image.naturalWidth))image.src=fallback();
}

category.addEventListener('change',()=>{
  state.filter=category.value;
  $$('.nav-link').forEach(link=>link.classList.toggle('active',link.dataset.filter===state.filter));
  render();
});
for(const control of [order,multipart])control.addEventListener('change',()=>render());
$('#searchToggle').addEventListener('click',event=>{
  event.stopImmediatePropagation();
  el.search.focus();
},true);

$('#autoExtract').checked=preferences.autoExtract!==false;
$('#gamesKey').value=preferences.gamesKey||'';
$('#openSettings').onclick=()=>settingsDialog.showModal();
async function refreshArchiveAuth(){try{const state=await window.desktop.archiveAuthStatus();$('#archiveAuthStatus').textContent=state.authenticated?'Sessão do Archive ativa neste computador.':'Sessão do Archive não detectada.'}catch{$('#archiveAuthStatus').textContent='Não foi possível verificar a sessão.'}}
$('#archiveLogin').onclick=async()=>{await window.desktop.archiveLogin();refreshArchiveAuth()};
$('#archiveLogout').onclick=async()=>{await window.desktop.archiveLogout();refreshArchiveAuth()};
settingsDialog.addEventListener('open',refreshArchiveAuth);
settingsDialog.addEventListener('close',()=>{
  const previousKey=preferences.gamesKey;
  preferences.autoExtract=$('#autoExtract').checked;
  preferences.gamesKey=$('#gamesKey').value.trim();
  savePreferences();
  if(previousKey!==preferences.gamesKey)refreshMetadata();
});

const downloadOne=downloadDesktop;
downloadDesktop=async function(item,file){
  let names;
  try{
    if(preferences.autoExtract!==false)names=archiveVolumes(item.files,file);
  }catch(error){showToast(error.message);return}
  if(!names)return downloadOne(item,file);
  if(!await allowRepeatDownload(item))return;
  if(!startTransfer('Baixando e extraindo '+item.title,undefined,{item,file}))return;
  try{
    const urls=item.sourceId?names.map(name=>fileUrl(item,item.files.find(file=>file.name===name))):undefined;
    const result=await window.desktop.downloadExtract(item.archiveId||item.id,names,urls);
    if(result.canceled){cancelTransfer();return}
    showExtractedResult(result.path,item);
    recordLocalCopy(item,file,result);
  }catch(error){failTransfer(error)}
};

const extractedActions=$('#extractedActions');
let extractedPath='';
let extractedItem=null;
function showExtractedResult(path,item=null){
  extractedPath=path;
  extractedItem=item;
  finishTransfer('Extração concluída. Arquivos salvos em '+path);
  extractedActions.hidden=false;
}

$('#sendExtracted').onclick=async()=>{
  const config=loadFtp();
  if(!config.host){
    populateFtp();
    ftpDialog.showModal();
    setFtpStatus('Configure o endereço do PS4 e salve. Depois selecione Enviar ao PS4.',false);
    return;
  }
  if(!startTransfer('Enviar arquivos extraídos','Escolha arquivos dentro da pasta extraída.',{item:extractedItem,local:true}))return;
  try{
    const result=await window.desktop.sendExtracted(config);
    if(result.canceled){
      cancelTransfer();
      $('#transferCard').hidden=false;
      $('#transferTitle').textContent='Arquivos extraídos';
      $('#transferPhase').textContent=extractedPath;
      setTransferProgress(100,'','Extração concluída');
    }else{
      finishTransfer(result.count+' arquivo(s) enviado(s) a '+result.remotePath+'.');
    }
  }catch(error){failTransfer(error)}
  finally{
    extractedActions.hidden=false;
    renderDownloadHistory();
  }
};

const showItemDetails=openDetails;
const officialPsnes={
  name:'IV0001-PSNE00001_00-PSNE000016070000.pkg',
  url:'https://github.com/Cpasjuste/pemu/releases/download/v6.7.1/IV0001-PSNE00001_00-PSNE000016070000.pkg',
  size:42598400,format:'PKG',source:'official'
};
function officialPackage(item){
  return String(item.serial).toUpperCase()==='PSNE00001'?officialPsnes:null;
}
function officialDownloadButton(item,mode){
  const file=officialPackage(item);
  const button=document.createElement('button');
  button.type='button';
  button.className=mode==='ps4'?'ps4-button focusable':'ghost-button focusable';
  button.textContent=mode==='ps4'?'Enviar versão oficial 6.7.1 ao PS4':'Baixar versão oficial 6.7.1';
  button.onclick=()=>{
    if(el.detailsDialog.open)el.detailsDialog.close();
    if(mode==='ps4')sendDesktop(item,file);
    else downloadDesktop(item,file);
  };
  return button;
}
function offerOfficialDownload(item,file,error,mode){
  const alternative=officialPackage(item);
  if(!alternative||file.url===alternative.url||!/HTTP (?:403|404|410)\b/.test(error.message))return;
  const target=$('#downloadRecovery');
  target.replaceChildren(officialDownloadButton(item,mode));
  target.hidden=false;
}

openDetails=function(id){
  showItemDetails(id);
  const item=state.items.find(candidate=>candidate.id===id);
  if(!item)return;
  ensureCover($('.details-cover',el.details),item);
  if(item.type!=='jogos')return;
  const actions=$('.details-actions',el.details);
  if(officialPackage(item))actions.append(officialDownloadButton(item,'pc'),officialDownloadButton(item,'ps4'));
  const button=document.createElement('button');
  button.className='ghost-button focusable';
  button.textContent='Buscar capa e dados';
  button.onclick=()=>{
    el.detailsDialog.close();
    $('#gameQuery').value=item.title;
    $('#metadataResults').replaceChildren();
    metadataDialog.showModal();
    lookupMetadata(item);
  };
  actions.append(button);
  if(item.providerSource){
    const source=document.createElement('button');
    source.className='ghost-button focusable';
    source.textContent='Fonte da capa · Wikipédia';
    source.onclick=()=>window.desktop.openExternal(item.providerSource);
    actions.append(source);
  }
};

function applyGameMetadata(item,game,manual=false){
  if(game.cover&&(manual||!item.catalogCover))item.cover=game.cover;
  if(game.description&&(!game.sourceUrl||!item.description||item.virtual))item.description=game.description;
  if(game.date)item.date=game.date.slice(0,4);
  item.providerId=game.id;
  item.providerTitle=game.title;
  item.providerSource=game.sourceUrl||'';
}

function lookup(item,title,key){
  return window.desktop.lookupGame(key||'',title,Boolean(item.serial?.startsWith('CUSA')));
}

function retryTime(retryAt){
  return new Date(retryAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function metadataError(error){
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
}

let lookupRevision=0;
async function lookupMetadata(item){
  const revision=++lookupRevision;
  const results=$('#metadataResults'),status=$('#metadataStatus');
  results.replaceChildren();
  status.textContent='Buscando capas e dados…';
  $('#metadataSearch').onsubmit=event=>{event.preventDefault();lookupMetadata(item)};
  try{
    const matches=await lookup(item,$('#gameQuery').value.trim(),preferences.gamesKey);
    if(revision!==lookupRevision||!metadataDialog.open)return;
    if(matches.retryAt){
      status.textContent='A Wikipédia limitou as consultas. Tente de novo a partir de '+retryTime(matches.retryAt)+'.';
      return;
    }
    status.textContent=matches.length?'Escolha o jogo e a plataforma.':'Nenhum jogo encontrado. Tente outro nome.';
    for(const game of matches){
      const row=document.createElement('button');
      row.type='button';
      row.className='ghost-button metadata-result';
      if(game.cover){
        const cover=document.createElement('img');
        cover.src=game.cover;
        cover.alt='';
        row.append(cover);
      }
      row.append(document.createTextNode([game.title,game.platform,game.date.slice(0,4)].filter(Boolean).join(' · ')));
      row.onclick=()=>{
        applyGameMetadata(item,game,true);
        saveItems();
        render();
        metadataDialog.close();
        openDetails(item.id);
      };
      results.append(row);
    }
  }catch(error){
    if(revision===lookupRevision)status.textContent=metadataError(error);
  }
}
$('#closeMetadata').onclick=()=>metadataDialog.close();
let metadataRunning=false;
const attempted=new Map();
async function refreshMetadata(manual=false){
  const button=$('#bulkMetadata'),status=$('#settingsStatus');
  const key=(manual?$('#gamesKey').value:preferences.gamesKey||'').trim();
  const source=key||'wiki';
  if(metadataRunning)return;
  metadataRunning=true;
  let updated=0,checked=0,resumed=false;
  button.disabled=true;
  try{
    if(manual)attempted.clear();
    while(true){
      const item=state.items.find(game=>game.type==='jogos'&&!game.catalogCover&&
        (!game.providerId||!game.cover||game.cover.startsWith('data:'))&&
        (manual||!(game.coverCheckedUntil>Date.now()))&&
        attempted.get(game.id)!==source);
      if(!item)break;
      status.textContent='Buscando capas e descrições… '+checked+' consultados.';
      const matches=await lookup(item,item.title,key);
      if(matches.retryAt){
        const delay=Math.max(0,matches.retryAt-Date.now());
        const prefix=updated+' capas atualizadas. A Wikipédia limitou as consultas. ';
        if(resumed||delay>15*60*1000){
          status.textContent=prefix+'Você pode retomar a partir de '+retryTime(matches.retryAt)+'.';
          return;
        }
        status.textContent=prefix+'A busca retoma às '+retryTime(matches.retryAt)+'.';
        resumed=true;
        await new Promise(resolve=>setTimeout(resolve,delay+250));
        continue;
      }
      attempted.set(item.id,source);
      checked++;
      const exact=matches.filter(game=>matchTitle(game.title)===matchTitle(item.title)&&game.cover);
      if(!state.items.includes(item))continue;
      if(exact.length!==1){
        item.coverCheckedUntil=Date.now()+24*60*60*1000;
        saveItems();
        continue;
      }
      applyGameMetadata(item,exact[0]);
      saveItems();
      updated++;
    }
    status.textContent=updated+' atualizados. '+(checked-updated)+' sem correspondência única.';
  }catch(error){status.textContent=updated+' atualizados. '+metadataError(error)}
  finally{metadataRunning=false;button.disabled=false;render()}
}
$('#bulkMetadata').onclick=()=>refreshMetadata(true);
el.form.addEventListener('submit',()=>{
  if(!el.importButton.disabled)return;
  el.importDialog.addEventListener('close',()=>refreshMetadata(),{once:true});
});

render();
refreshMetadata();

