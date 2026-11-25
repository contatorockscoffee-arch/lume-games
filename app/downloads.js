const downloadHistoryKey='meu-acervo-download-history-v1';
let downloadHistory=[];
try{
  const saved=JSON.parse(localStorage.getItem(downloadHistoryKey));
  if(Array.isArray(saved)){
    downloadHistory=saved.map(entry=>entry.status==='active'
      ?{...entry,status:'interrupted',message:'Aplicativo fechado durante a transferência.'}
      :entry);
  }
}catch{}
let activeTransfer=null;
const localLibraryKey='meu-acervo-local-library-v1';
let localLibrary=[];
try{
  const saved=JSON.parse(localStorage.getItem(localLibraryKey));
  if(Array.isArray(saved))localLibrary=saved;
}catch{}
let currentDownloadTab='progress',libraryRevision=0;
const desktopQueueKey='lume-desktop-download-queue-v1';
const MAX_QUEUE_ITEMS=30,MAX_CONCURRENT_DOWNLOADS=3;
let desktopQueue=[];
try{const saved=JSON.parse(localStorage.getItem(desktopQueueKey));if(Array.isArray(saved))desktopQueue=saved.map(job=>job.status==='active'?{...job,status:'queued',message:'Retomando após reabrir o aplicativo.'}:job).filter(job=>job?.item&&job?.file)}catch{}

function saveDesktopQueue(){try{localStorage.setItem(desktopQueueKey,JSON.stringify(desktopQueue.slice(0,MAX_QUEUE_ITEMS)))}catch{}}
function queueJobs(){return desktopQueue.filter(job=>['queued','active','paused'].includes(job.status))}
function queueTitle(job){return job.file?.name||job.item?.title||'Download'}
function queuePercent(job){return job.total?Math.max(0,Math.min(100,job.done/job.total*100)):0}
function renderDesktopQueue(){
  const container=$('#desktopQueueCards');if(!container)return;
  const jobs=queueJobs();container.replaceChildren();
  $('#downloadsEmpty').hidden=jobs.length>0||!$('#transferCard').hidden;
  $('#downloadIndicator').hidden=jobs.length===0&&!activeTransfer;
  for(const job of jobs){
    const card=document.createElement('article');card.className='queue-card';
    const title=document.createElement('h3');title.textContent=(job.status==='active'?'Baixando ':job.status==='queued'?'Na fila ':job.status==='paused'?'Pausado ':'')+queueTitle(job);card.append(title);
    const source=document.createElement('p');source.textContent=transferSourceText(job)||'Preparando origem…';card.append(source);
    const phase=document.createElement('p');phase.textContent=job.message||({active:'Baixando arquivo…',queued:'Aguardando vaga na fila…',paused:'Pausado.'}[job.status]||'');card.append(phase);
    const track=document.createElement('div');track.className='progress-track';const bar=document.createElement('div');bar.style.width=queuePercent(job)+'%';track.append(bar);card.append(track);
    const metrics=document.createElement('div');metrics.className='queue-metrics';const percent=document.createElement('strong');percent.textContent=job.total?progressLabel(queuePercent(job)):(job.status==='queued'?'Fila':'—');const bytes=document.createElement('span');bytes.textContent=[formatBytes(job.done),job.total?formatBytes(job.total):''].filter(Boolean).join(' / ');const speed=document.createElement('span');speed.textContent=job.speed?formatBytes(job.speed)+'/s':'';const eta=document.createElement('span');eta.textContent=job.total&&job.speed?formatEta((job.total-job.done)/job.speed):'';metrics.append(percent,bytes,speed,eta);card.append(metrics);
    const actions=document.createElement('div');actions.className='queue-actions';
    if(job.status==='active'||job.status==='paused'){const pause=document.createElement('button');pause.className='ghost-button';pause.dataset.queueAction=job.status==='active'?'pause':'resume';pause.dataset.jobId=job.id;pause.textContent=job.status==='active'?'Pausar':'Continuar';actions.append(pause)}
    const cancel=document.createElement('button');cancel.className='danger-button';cancel.dataset.queueAction='cancel';cancel.dataset.jobId=job.id;cancel.textContent='Cancelar';actions.append(cancel);card.append(actions);container.append(card);
  }
}
function newQueueId(){return 'job-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)}
function enqueueDesktopDownload(item,file){
  if(queueJobs().length>=MAX_QUEUE_ITEMS){showToast('A fila já tem o limite de 30 downloads.');return false}
  const duplicate=queueJobs().find(job=>job.item?.id===item.id&&job.file?.name===file.name);if(duplicate){showDownloads(true);showToast('Esse arquivo já está na fila.');return false}
  let requestedHost='';try{requestedHost=new URL(fileUrl(item,file)).hostname}catch{}
  const job={id:newQueueId(),title:'Baixando '+file.name,startedAt:Date.now(),status:'queued',item,file,requestedHost,catalog:file?.source==='official'?'Versão oficial':item.sourceId?'GitHub':'Internet Archive',done:0,total:Number(file.size)||0,message:'Aguardando vaga na fila…'};
  desktopQueue.push(job);saveDesktopQueue();renderDesktopQueue();syncTransferCards();pumpDesktopQueue();showToast('Adicionado à fila.');return true;
}
function pumpDesktopQueue(){
  while(desktopQueue.filter(job=>job.status==='active').length<MAX_CONCURRENT_DOWNLOADS){const job=desktopQueue.find(entry=>entry.status==='queued');if(!job)break;runDesktopJob(job)}
  renderDesktopQueue();syncTransferCards();
}
async function runDesktopJob(job){
  job.status='active';job.pauseRequested=false;job.cancelRequested=false;job.message='Baixando arquivo…';job.startedAt=Date.now();saveDesktopQueue();renderDesktopQueue();syncTransferCards();
  try{const result=await window.desktop.download(fileUrl(job.item,job.file),job.file.name,{jobId:job.id});if(result.canceled){job.status='canceled';job.message='Cancelado.'}else{job.status='done';job.message='Arquivo salvo em '+result.path;recordLocalCopy(job.item,job.file,result);downloadHistory.unshift({...job,status:'done'});downloadHistory=downloadHistory.slice(0,30)}}
  catch(error){if(job.pauseRequested){job.status='paused';job.message='Pausado. O arquivo parcial foi mantido.'}else if(job.cancelRequested){job.status='canceled';job.message='Cancelado.'}else{job.status='error';job.message=metadataError(error);downloadHistory.unshift({...job,status:'error'});downloadHistory=downloadHistory.slice(0,30)}}
  saveDesktopQueue();saveDownloadHistory();renderDownloadHistory();renderDesktopQueue();syncTransferCards();pumpDesktopQueue();
}
async function queueAction(action,id){
  const job=desktopQueue.find(entry=>entry.id===id);if(!job)return;
  if(action==='pause'&&job.status==='active'){job.pauseRequested=true;job.message='Pausando…';saveDesktopQueue();renderDesktopQueue();await window.desktop.pauseDownload(job.id)}
  if(action==='resume'&&job.status==='paused'){job.status='queued';job.message='Aguardando vaga na fila…';saveDesktopQueue();pumpDesktopQueue()}
  if(action==='cancel'){job.cancelRequested=true;if(job.status==='active'){job.message='Cancelando…';saveDesktopQueue();renderDesktopQueue();await window.desktop.cancelDownload(job.id)}else{desktopQueue=desktopQueue.filter(entry=>entry!==job);saveDesktopQueue();renderDesktopQueue();pumpDesktopQueue()}}
}
$('#desktopQueueCards').addEventListener('click',event=>{const button=event.target.closest('[data-queue-action]');if(button)queueAction(button.dataset.queueAction,button.dataset.jobId)});

function saveDownloadHistory(){
  try{localStorage.setItem(downloadHistoryKey,JSON.stringify(downloadHistory.slice(0,30)))}catch{}
}

const downloadStatus={done:'Concluído',error:'Falhou',interrupted:'Interrompido'};
function renderDownloadHistory(){
  const finished=downloadHistory.filter(entry=>entry.status!=='active');
  const list=$('#downloadHistory');
  list.replaceChildren();
  for(const entry of finished){
    const row=document.createElement('li');
    const title=document.createElement('strong');
    title.textContent=entry.title;
    const details=document.createElement('small');
    details.textContent=[downloadStatus[entry.status],new Date(entry.startedAt).toLocaleString('pt-BR'),transferSourceText(entry),
      entry.message].filter(Boolean).join(' · ');
    row.append(title,details);
    list.append(row);
  }
  $('#downloadHistorySection').hidden=!finished.length;
  $('#downloadHistoryEmpty').hidden=Boolean(finished.length);
  $('#downloadsEmpty').hidden=!$('#transferCard').hidden;
}

function setDownloadTab(tab){
  currentDownloadTab=tab;
  $('#downloadProgressPanel').hidden=tab!=='progress';
  $('#downloadLibraryPanel').hidden=tab!=='library';
  $('#downloadHistoryPanel').hidden=tab!=='history';
  for(const button of $$('[data-download-tab]')){
    button.setAttribute('aria-pressed',String(button.dataset.downloadTab===tab));
  }
  if(tab==='library')showLocalLibrary();
}

function recordLocalCopy(item,file,result){
  if(!result?.copy)return;
  const entry={
    id:item.id,type:item.type,title:item.title,serial:item.serial||'',providerTitle:item.providerTitle||'',
    filename:file.name,copy:result.copy,savedAt:Date.now()
  };
  localLibrary=[entry,...localLibrary.filter(previous=>previous.copy.path!==entry.copy.path)];
  try{localStorage.setItem(localLibraryKey,JSON.stringify(localLibrary))}catch{}
  if(currentDownloadTab==='library')showLocalLibrary();
}

async function allowRepeatDownload(item){
  const matches=localLibrary.filter(entry=>entry.id===item.id||(item.type==='jogos'&&sameGame(entry,item)));
  if(!matches.length)return true;
  try{
    const states=await window.desktop.checkLocalCopies(matches.map(entry=>entry.copy));
    const existing=matches[states.indexOf(true)];
    return !existing||confirm('Você já baixou “'+item.title+'”.\n'+existing.copy.path+'\n\nBaixar novamente?');
  }catch{return true}
}

async function showLocalLibrary(){
  const revision=++libraryRevision;
  const status=$('#downloadLibraryStatus'),list=$('#downloadLibrary');
  const entries=localLibrary.slice();
  if(!entries.length){status.textContent='Nenhum arquivo baixado por esta versão.';list.replaceChildren();return}
  status.textContent='Conferindo as cópias salvas…';
  let states;
  try{states=await window.desktop.checkLocalCopies(entries.map(entry=>entry.copy))}
  catch{if(revision===libraryRevision)status.textContent='Não foi possível conferir as cópias locais.';return}
  if(revision!==libraryRevision)return;
  list.replaceChildren();
  for(const [index,entry] of entries.entries()){
    const row=document.createElement('li');
    const title=document.createElement('strong');
    title.textContent=entry.title;
    const detail=document.createElement('small');
    detail.textContent=(states[index]?'Baixado':'Arquivo ausente · disponível para baixar novamente')+' · '+entry.copy.path;
    row.append(title,detail);
    const item=state.items.find(candidate=>candidate.id===entry.id)||
      state.items.find(candidate=>sameGame(entry,candidate));
    const official=item?officialPackage(item):null;
    const file=item?.files?.find(candidate=>candidate.name===entry.filename)||
      (official?.name===entry.filename?official:null)||
      (item?.id===entry.id?item.files?.[0]:null);
    if(item&&!states[index]){
      const button=document.createElement('button');
      button.type='button';
      button.className='ghost-button focusable';
      button.textContent=file?'Baixar novamente':'Ver opções de download';
      button.onclick=()=>{
        if(file)downloadDesktop(item,file);
        else openDetails(item.id);
      };
      row.append(button);
    }
    list.append(row);
  }
  status.textContent=states.filter(Boolean).length+' de '+entries.length+' cópias no local salvo.';
}

function showDownloads(visible,focus=false){
  $('#inicio').hidden=visible;
  $('#downloadsPage').hidden=!visible;
  $('#openDownloads').setAttribute('aria-pressed',String(visible));
  if(focus)(visible?$('#backToCatalog'):$('#openDownloads')).focus();
  if(visible){
    renderDownloadHistory();
    if(currentDownloadTab==='library')showLocalLibrary();
  }
}

function setTransferProgress(percent,bytes='',label=''){
  const track=$('#transferTrack');
  const valid=Number.isFinite(percent);
  if(valid){
    const value=Math.max(0,Math.min(100,percent));
    track.setAttribute('aria-valuenow',String(value));
    $('#transferBar').style.width=value+'%';
  }else{
    track.removeAttribute('aria-valuenow');
    $('#transferBar').style.width='12%';
  }
  $('#transferPercent').textContent=label||(valid?progressLabel(percent):'Em andamento');
  $('#transferBytes').textContent=bytes;
}
function formatEta(seconds){if(!Number.isFinite(seconds)||seconds<0)return '';seconds=Math.ceil(seconds);const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return h?`${h}h ${m}min restantes`:m?`${m}min ${s}s restantes`:`${s}s restantes`}

function progressLabel(percent){
  if(percent>0&&percent<1)return '<1%';
  return Math.max(0,Math.min(100,Math.floor(percent)))+'%';
}

function transferSourceText(entry){
  if(entry.local)return 'Origem: arquivos extraídos no PC';
  const host=entry.actualHost||entry.requestedHost;
  const archive=host==='archive.org'||host?.endsWith('.archive.org');
  const github=host==='github.com'||host?.endsWith('.githubusercontent.com');
  const domain=archive?'Internet Archive ('+host+')':github?'GitHub ('+host+')':host;
  return [
    entry.catalog?'Catálogo: '+entry.catalog:'',
    domain?'Servidor do arquivo: '+domain:''
  ].filter(Boolean).join(' · ');
}

function renderTransferSource(entry){
  const source=$('#transferSource');
  const text=transferSourceText(entry);
  if(source.textContent!==text)source.textContent=text;
  source.hidden=!text;
}

function transferCardLabel(entry){
  if(entry.phase==='extract')return 'Extraindo';
  if(entry.phase==='upload'||entry.local){
    return 'Enviando'+(Number.isFinite(entry.percent)?' '+progressLabel(entry.percent):'');
  }
  if(entry.phase==='download'){
    return 'Baixando'+(Number.isFinite(entry.percent)?' '+progressLabel(entry.percent):'');
  }
  return 'Preparando';
}

function syncTransferCards(){
  const transfers=[...desktopQueue.filter(job=>['queued','active','paused'].includes(job.status)),...(activeTransfer?[activeTransfer]:[])];
  for(const card of $$('.media-card',el.grid)){
    const candidate=state.items.find(entry=>entry.id===card.dataset.id);
    const transfer=transfers.find(entry=>candidate&&entry.item&&(candidate.id===entry.item.id||sameGame(entry.item,candidate)));
    const isActive=Boolean(transfer);
    card.classList.toggle('transfer-active',isActive);
    const previous=$('.card-transfer',card);
    if(!isActive){previous?.remove();continue}
    const label=transfer.status==='queued'?'Na fila':transfer.status==='paused'?'Pausado':transferCardLabel(transfer);
    if(previous){previous.textContent=label;continue}
    const badge=document.createElement('span');
    badge.className='card-transfer';
    badge.textContent=label;
    card.append(badge);
  }
}

function startTransfer(title,message='Preparando arquivo…',{item,file,local=false}={}){
  if(activeTransfer){
    showDownloads(true);
    showToast('Já existe uma transferência em andamento.');
    return false;
  }
  let requestedHost='';
  try{if(item&&file)requestedHost=new URL(fileUrl(item,file)).hostname}catch{}
  const identity=item?{id:item.id,type:item.type,title:item.title,serial:item.serial,providerTitle:item.providerTitle}:null;
  const catalog=item?(file?.source==='official'?'Versão oficial':item.sourceId?'GitHub':'Internet Archive'):'';
  activeTransfer={title,startedAt:Date.now(),status:'active',item:identity,catalog,requestedHost,local,
    resume:item&&file?{item,file}:null};
  downloadHistory=[activeTransfer,...downloadHistory].slice(0,30);
  saveDownloadHistory();
  $('#transferCard').hidden=false;
  $('#downloadIndicator').hidden=false;
  $('#extractedActions').hidden=true;
  $('#downloadRecovery').hidden=true;
  $('#downloadRecovery').replaceChildren();
  $('#transferTitle').textContent=title;
  $('#transferPhase').textContent=message;
  renderTransferSource(activeTransfer);
  setTransferProgress(0);
  $('#transferSpeed').textContent='';$('#transferEta').textContent='';
  syncTransferCards();
  renderDownloadHistory();
  showToast('Transferência iniciada. Acompanhe na aba Downloads.');
  return true;
}

function endTransfer(status,message){
  if(!activeTransfer)return;
  activeTransfer.status=status;
  activeTransfer.message=message;
  if(status==='canceled')downloadHistory=downloadHistory.filter(entry=>entry!==activeTransfer);
  activeTransfer=null;
  syncTransferCards();
  saveDownloadHistory();
  $('#downloadIndicator').hidden=true;
  $('#transferPhase').textContent=message;
  $('#transferCard').hidden=status==='canceled';
  setTransferProgress(status==='done'?100:0,'',downloadStatus[status]);
  renderDownloadHistory();
  if($('#downloadsPage').hidden&&status!=='canceled'){
    showToast(status==='done'?'Transferência concluída. Veja em Downloads.':'A transferência falhou. Veja em Downloads.');
  }
}

function finishTransfer(message){endTransfer('done',message)}
function failTransfer(error){endTransfer('error',metadataError(error))}
function cancelTransfer(){endTransfer('canceled','Transferência cancelada.')}
function pauseTransfer(){if(!activeTransfer)return;activeTransfer.status='paused';activeTransfer.message='Pausado. O arquivo parcial foi mantido para continuar depois.';activeTransfer.phase='paused';saveDownloadHistory();$('#transferPhase').textContent=activeTransfer.message;$('#pauseDownload').textContent='Continuar';$('#pauseDownload').disabled=false;showToast('Download pausado.');}
async function resumeTransfer(){if(!activeTransfer||activeTransfer.status!=='paused'||!activeTransfer.resume)return;const pending=activeTransfer.resume;downloadHistory=downloadHistory.filter(entry=>entry!==activeTransfer);saveDownloadHistory();activeTransfer=null;$('#pauseDownload').disabled=true;await downloadDesktop(pending.item,pending.file)}
$('#cancelDownload').onclick=async()=>{if(!activeTransfer)return;$('#cancelDownload').disabled=true;try{await window.desktop.cancelDownload();cancelTransfer()}catch{failTransfer(new Error('Não foi possível cancelar a transferência.'))}finally{$('#cancelDownload').disabled=false}};
$('#pauseDownload').onclick=async()=>{if(!activeTransfer)return;if(activeTransfer.status==='paused'){await resumeTransfer();return}activeTransfer.pauseRequested=true;window.__lumePauseRequested=true;$('#pauseDownload').disabled=true;try{await window.desktop.pauseDownload()}catch{window.__lumePauseRequested=false;$('#pauseDownload').disabled=false;failTransfer(new Error('Não foi possível pausar a transferência.'))}};

window.desktop.onProgress(progress=>{
  const queued=desktopQueue.find(job=>job.id===progress.jobId);
  if(queued){
    queued.phase=progress.phase;queued.done=progress.done||0;queued.total=progress.total||queued.total||0;queued.percent=progress.percent;
    if(progress.host)queued.actualHost=progress.host;
    const elapsed=Math.max(.2,(Date.now()-queued.startedAt)/1000);queued.speed=queued.done/elapsed;
    queued.message=progress.phase==='download'?'Baixando arquivo…':progress.phase||'Em andamento…';
    saveDesktopQueue();renderDesktopQueue();syncTransferCards();return;
  }
  if(!activeTransfer)return;
  activeTransfer.phase=progress.phase;
  activeTransfer.percent=progress.percent;
  if(progress.host&&activeTransfer.actualHost!==progress.host){
    activeTransfer.actualHost=progress.host;
    renderTransferSource(activeTransfer);
  }
  const phase=progress.phase==='upload'?'Enviando ao PS4 por FTP…'
    :progress.phase==='extract'?'Extraindo com 7-Zip…'
    :progress.operation?.startsWith('extract-')?'Baixando volume '+progress.operation.slice(8)
    :'Baixando arquivo…';
  if($('#transferPhase').textContent!==phase)$('#transferPhase').textContent=phase;
  const bytes=progress.phase==='extract'?'':[
    formatBytes(progress.done),progress.total?formatBytes(progress.total):''
  ].filter(Boolean).join(' / ');
  setTransferProgress(progress.percent,bytes,progress.phase==='extract'?'Extraindo':'');
  if(progress.phase==='download'&&progress.done>0){
    const elapsed=Math.max(0,(Date.now()-activeTransfer.startedAt)/1000);
    const speed=progress.done/elapsed;
    $('#transferSpeed').textContent='· '+formatBytes(speed)+'/s';
    if(progress.total&&speed>0)$('#transferEta').textContent='· '+formatEta((progress.total-progress.done)/speed);
  }
  const label=transferCardLabel(activeTransfer);
  for(const badge of $$('.card-transfer',el.grid))if(badge.textContent!==label)badge.textContent=label;
});

$('#openDownloads').onclick=()=>{
  if(activeTransfer)setDownloadTab('progress');
  showDownloads(true,true);
};
$('#backToCatalog').onclick=()=>showDownloads(false,true);
for(const button of $$('[data-download-tab]')){
  button.onclick=()=>setDownloadTab(button.dataset.downloadTab);
}
for(const button of $$('.nav-link,.brand,#searchToggle')){
  button.addEventListener('click',()=>showDownloads(false),true);
}
saveDownloadHistory();
renderDownloadHistory();
renderDesktopQueue();
setTimeout(pumpDesktopQueue,700);

// Se o aplicativo foi fechado com uma transferência ativa, o arquivo .part
// permanece no disco e o processo principal retoma via HTTP Range.
const pendingResume=downloadHistory.find(entry=>entry.status==='active'&&entry.resume?.item&&entry.resume?.file);
if(pendingResume){
  setTimeout(()=>{if(typeof downloadDesktop==='function'&&!activeTransfer)downloadDesktop(pendingResume.resume.item,pendingResume.resume.file)},700);
}

