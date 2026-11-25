const STORAGE_KEY='meu-acervo-items-v1';
const state={items:loadItems(),filter:'todos',query:'',selected:null};
const CARD_SIZE_KEY='lume-card-size-v1';
const $=(s,r=document)=>r.querySelector(s);const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const el={grid:$('#grid'),empty:$('#emptyState'),count:$('#itemCount'),importDialog:$('#importDialog'),detailsDialog:$('#detailsDialog'),details:$('#detailsContent'),form:$('#importForm'),input:$('#archiveInput'),status:$('#importStatus'),importButton:$('#importButton'),search:$('#searchInput'),searchBox:$('#searchBox'),toast:$('#toast')};
function setupCardDensity(){const input=$('#cardSize');if(!input)return;const saved=Number(localStorage.getItem(CARD_SIZE_KEY));const value=Number.isFinite(saved)?Math.max(160,Math.min(300,saved)):205;const apply=()=>{document.documentElement.style.setProperty('--card-min',`${input.value}px`);const output=$('#cardSizeValue');if(output){output.value=`${input.value}px`;output.textContent=`${input.value}px`}localStorage.setItem(CARD_SIZE_KEY,input.value)};input.value=String(value);apply();input.addEventListener('input',apply)}

function loadItems(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||[]}catch{return[]}}
function saveItems(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state.items))}
function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function stripHtml(v=''){const d=document.createElement('div');d.innerHTML=v;return d.textContent||''}
function asArray(v){return Array.isArray(v)?v:v?[v]:[]}
function formatBytes(n){n=Number(n)||0;if(!n)return '—';const u=['B','KB','MB','GB','TB'];const i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),4);return `${(n/1024**i).toFixed(i>1?1:0)} ${u[i]}`}
function parseIdentifier(value){
  const input=value.trim();
  try{
    if(/^[\w.-]+$/.test(input)&&!['.','..'].includes(input))return input;
    const url=new URL(/^https?:\/\//i.test(input)?input:'https://'+input);
    if(!['archive.org','www.archive.org'].includes(url.hostname))return '';
    const [,kind,encoded]=url.pathname.split('/');
    const id=decodeURIComponent(encoded||'');
    return ['details','download','metadata'].includes(kind)&&/^[\w.-]+$/.test(id)&&!['.','..'].includes(id)?id:'';
  }catch{return ''}
}
function inferType(meta,override){if(override!=='auto')return override;const mediatype=String(meta.mediatype||'').toLowerCase();const subjects=asArray(meta.subject).join(' ').toLowerCase();if(mediatype==='movies'||/movie|film|cinema|video/.test(subjects))return 'filmes';if(mediatype==='texts'||/book|livro|magazine|manual/.test(subjects))return 'livros';return 'jogos'}
function typeLabel(t){return({jogos:'JOGO',filmes:'FILME',livros:'LIVRO'})[t]||'ITEM'}
function safeDownloadUrl(id,name){return `https://archive.org/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`}
function relevantFiles(files=[]){return files.filter(f=>f.name&&!f.name.startsWith('__')&&!/(_meta\.xml|_files\.xml|_reviews\.xml|_archive\.torrent|_itemimage\.png)$/i.test(f.name)&&!/^(metadata|itemimage|reviews|torrent)$/i.test(String(f.format||''))).map(f=>({name:f.name,size:Number(f.size)||0,format:f.format||'',source:f.source||''})).sort((a,b)=>(b.source==='original')-(a.source==='original')||b.size-a.size)}

function hashText(value){let h=2166136261;for(const c of value){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return Math.abs(h)}
function retroCover(title,serial,index){const palettes=[['#ff3cac','#713cff'],['#2cf6ff','#0878ff'],['#ffe156','#ff6b35'],['#50fa7b','#008f7a'],['#ff6ec7','#7b2cff']];const p=palettes[(hashText(title)+index)%palettes.length];const words=title.split(/\s+/);const lines=[];let current='';for(const word of words){if((current+' '+word).trim().length>17&&current){lines.push(current);current=word}else current=(current+' '+word).trim()}if(current)lines.push(current);const shown=lines.slice(0,4);const text=shown.map((line,i)=>'<text x="40" y="'+(260+i*58)+'" fill="white" font-family="Arial, sans-serif" font-size="42" font-weight="900">'+escapeHtml(line)+'</text>').join('');const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750" viewBox="0 0 600 750"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="'+p[0]+'"/><stop offset="1" stop-color="'+p[1]+'"/></linearGradient><pattern id="s" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 10L10 0" stroke="white" stroke-opacity=".08"/></pattern></defs><rect width="600" height="750" fill="#07101f"/><circle cx="500" cy="80" r="240" fill="url(#g)" opacity=".55"/><rect width="600" height="750" fill="url(#s)"/><text x="40" y="80" fill="'+p[0]+'" font-family="monospace" font-size="24" font-weight="700">MEU ACERVO // PS4</text>'+text+'<rect x="40" y="650" width="520" height="2" fill="'+p[0]+'"/><text x="40" y="700" fill="#c8d5e8" font-family="monospace" font-size="28">'+escapeHtml(serial||'PLAYSTATION 4')+'</text></svg>';return 'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg)}
function splitPs4Bundle(identifier,metadata,files){
  const groups=new Map();
  for(const file of files){
    const match=file.name.match(/^(.*?)\s*\[(CUSA\d{5})\]\s*\[([^\]]+)\](?:\s*\[\+?(\d+)\s+DLC\])?/i);
    if(!match)continue;
    const [,name,code,release,extra]=match;
    const serial=code.toUpperCase(),version=release.trim(),dlc=Number(extra||0);
    const key=[serial,version,dlc].join(':');
    if(!groups.has(key))groups.set(key,{title:name.trim(),serial,version,dlc,files:[]});
    groups.get(key).files.push(file);
  }
  if(!groups.size)return null;
  const items=[...groups].map(([key,game],index)=>({
    ...game,id:identifier+'::'+key,archiveId:identifier,virtual:true,
    creator:game.serial+' · v'+game.version,date:'',
    description:'Versão '+game.version+' para PlayStation 4.',
    type:'jogos',cover:retroCover(game.title,game.serial,index),
    detailsUrl:'https://archive.org/details/'+encodeURIComponent(identifier),
    totalSize:game.files.reduce((sum,file)=>sum+file.size,0),
    formats:[...new Set(game.files.map(file=>file.format).filter(Boolean))],addedAt:Date.now()+index
  }));
  return {kind:'bundle',archiveId:identifier,title:asArray(metadata.title)[0]||identifier,items};
}

async function fetchArchiveItem(identifier,typeOverride){const response=await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Não consegui encontrar esse item no Internet Archive.');const data=await response.json();if(!data.metadata||!data.metadata.identifier)throw new Error('O item não possui metadados públicos disponíveis.');const m=data.metadata;const files=relevantFiles(data.files);const bundle=splitPs4Bundle(identifier,m,files);if(bundle)return bundle;const title=asArray(m.title)[0]||identifier;const creator=asArray(m.creator).join(', ')||'Autor não informado';const date=String(asArray(m.date)[0]||asArray(m.publicdate)[0]||'').slice(0,4);return{id:identifier,title,creator,date,platformHints:m.platform||m.system,platformTags:[...asArray(m.collection),...asArray(m.subject)],description:stripHtml(asArray(m.description)[0]||'Sem descrição disponível.'),type:inferType(m,typeOverride),cover:`https://archive.org/services/img/${encodeURIComponent(identifier)}`,detailsUrl:`https://archive.org/details/${encodeURIComponent(identifier)}`,files,totalSize:files.reduce((a,f)=>a+f.size,0),formats:[...new Set(files.map(f=>f.format).filter(Boolean))],addedAt:Date.now()}}

function filteredItems(){return state.items.filter(i=>(state.filter==='todos'||i.type===state.filter)&&(!state.query||`${i.title} ${i.creator}`.toLowerCase().includes(state.query)))}
const catalogPageSize=150;
let catalogPage=0,previousCatalogView='';
function render(){
  const items=filteredItems();
  const view=JSON.stringify([state.filter,state.query,...['catalogSourceFilter','catalogPlatform','catalogContent',
    'catalogTarget','catalogOrder'].map(id=>$('#'+id)?.value),$('#multipartOnly')?.checked]);
  if(view!==previousCatalogView){catalogPage=0;previousCatalogView=view}
  const pages=Math.max(1,Math.ceil(items.length/catalogPageSize));
  catalogPage=Math.min(catalogPage,pages-1);
  const offset=catalogPage*catalogPageSize;
  const visible=items.slice(offset,offset+catalogPageSize);
  el.empty.hidden=state.items.length>0;
  el.grid.hidden=state.items.length===0;
  el.count.textContent=items.length+(items.length===1?' item':' itens');
  el.grid.innerHTML=visible.map(i=>`<button class="media-card focusable" data-id="${escapeHtml(i.id)}" aria-label="Abrir ${escapeHtml(i.title)}"><img class="card-cover" src="${escapeHtml(i.cover)}" alt="" loading="lazy" decoding="async"><span class="card-gradient"></span><span class="card-type">${typeLabel(i.type)}</span><span class="card-info"><h3>${escapeHtml(i.title)}</h3><p>${escapeHtml([i.creator,i.date].filter(Boolean).join(' · '))}</p></span></button>`).join('');
  $('#catalogPages').hidden=pages<=1;
  $('#catalogPageLabel').textContent=(offset+1)+'–'+(offset+visible.length)+' de '+items.length;
  $('#catalogPrevious').disabled=catalogPage===0;
  $('#catalogNext').disabled=catalogPage+1>=pages;
}
el.grid.addEventListener('click',event=>{
  const card=event.target.closest('.media-card');
  if(card)openDetails(card.dataset.id);
});
for(const [id,step] of [['catalogPrevious',-1],['catalogNext',1]]){
  $('#'+id).onclick=()=>{
    catalogPage+=step;
    render();
    $('#library').scrollIntoView?.({block:'start'});
  };
}

function openImport(){el.status.textContent='';el.importDialog.showModal();setTimeout(()=>el.input.focus(),50)}
function closeDialog(dialog){dialog.close()}
function showToast(message){el.toast.textContent=message;el.toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>el.toast.classList.remove('show'),2600)}

function importItem(event){event.preventDefault();return importCatalogSource()}

function openDetails(id){const item=state.items.find(i=>i.id===id);if(!item)return;state.selected=id;const files=item.files||[];const primary=files.find(f=>f.source==='original'&&f.size)||files[0];el.details.innerHTML=`<div class="details-backdrop" style="background-image:url('${escapeHtml(item.cover)}')"></div><button class="dialog-close focusable" data-close-details aria-label="Fechar">×</button><div class="details-body"><div><img class="details-cover" src="${escapeHtml(item.cover)}" alt="Capa de ${escapeHtml(item.title)}"></div><div class="details-copy"><span class="dialog-kicker">${typeLabel(item.type)}</span><h2>${escapeHtml(item.title)}</h2><div class="details-meta"><span>${escapeHtml(item.creator)}</span>${item.date?`<span>·</span><span>${escapeHtml(item.date)}</span>`:''}<span>·</span><span>${files.length} arquivos</span><span>·</span><span>${formatBytes(item.totalSize)}</span></div><p class="details-description">${escapeHtml(item.description)}</p><div class="details-actions"><a class="primary-button focusable" href="${primary?safeDownloadUrl(item.id,primary.name):item.detailsUrl}" ${primary?'download':''}>Baixar${primary?` · ${formatBytes(primary.size)}`:''}</a><a class="ghost-button focusable" href="${escapeHtml(item.detailsUrl)}" target="_blank" rel="noopener">Visualizar original</a><button class="danger-button focusable" data-remove>Remover</button></div><div class="files-title"><h3>Arquivos disponíveis</h3><span class="item-count">${item.formats.slice(0,3).map(escapeHtml).join(' · ')}</span></div><div class="files-list">${files.length?files.slice(0,60).map(f=>`<div class="file-row"><span class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><span class="file-size">${formatBytes(f.size)}</span><a class="file-download focusable" href="${safeDownloadUrl(item.id,f.name)}" download>Baixar</a></div>`).join(''):'<p class="item-count">Nenhum arquivo público encontrado.</p>'}</div></div></div>`;el.detailsDialog.showModal();$('[data-close-details]',el.details).onclick=()=>closeDialog(el.detailsDialog);$('[data-remove]',el.details).onclick=()=>{if(confirm(`Remover “${item.title}” do catálogo?`)){state.items=state.items.filter(i=>i.id!==id);saveItems();render();closeDialog(el.detailsDialog);showToast('Item removido do catálogo.')}}}

$$('[data-open-import],#openImport,#heroAdd').forEach(b=>b.addEventListener('click',openImport));el.form.addEventListener('submit',importItem);$('#searchToggle').addEventListener('click',()=>{el.searchBox.classList.toggle('open');if(el.searchBox.classList.contains('open'))el.search.focus()});el.search.addEventListener('input',()=>{state.query=el.search.value.trim().toLowerCase();render()});$$('.nav-link').forEach(b=>b.addEventListener('click',()=>{$$('.nav-link').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.filter=b.dataset.filter;render();$('#library').scrollIntoView({behavior:'smooth'})}));$('#learnMore').addEventListener('click',()=>$('#helpDialog').showModal());$('[data-close-help]').addEventListener('click',()=>closeDialog($('#helpDialog')));$('[data-help-add]').addEventListener('click',()=>{closeDialog($('#helpDialog'));openImport()});

document.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||document.querySelector('dialog[open]'))return;const cards=$$('.media-card');const idx=cards.indexOf(document.activeElement);if(idx<0)return;const columns=Math.max(1,Math.round(el.grid.clientWidth/cards[0].clientWidth));const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[e.key];const next=cards[Math.max(0,Math.min(cards.length-1,idx+delta))];if(next){e.preventDefault();next.focus()}});
setupCardDensity();
render();

// Recursos exclusivos da edição Windows
const FTP_KEY='meu-acervo-ftp-v1';
const ftpDialog=$('#ftpDialog'),ftpForm=$('#ftpForm');
function loadFtp(){try{return JSON.parse(localStorage.getItem(FTP_KEY))||{}}catch{return{}}}
function getFtpForm(){return{host:$('#ftpHost').value.trim(),port:Number($('#ftpPort').value)||2121,user:$('#ftpUser').value.trim()||'anonymous',password:$('#ftpPassword').value,remotePath:$('#ftpPath').value.trim()||'/data/pkg'}}
function populateFtp(){const c=loadFtp();$('#ftpHost').value=c.host||'';$('#ftpPort').value=c.port||2121;$('#ftpUser').value=c.user||'anonymous';$('#ftpPassword').value=c.password||'';$('#ftpPath').value=c.remotePath||'/data/pkg';$('#openFtp').classList.toggle('configured',Boolean(c.host))}
function setFtpStatus(text,ok){const node=$('#ftpStatus');node.textContent=text;node.style.color=ok?'#50fa7b':'#ff9ca5'}
function fileUrl(item,file){return file.url||safeDownloadUrl(item.archiveId||item.id,file.name)}
async function downloadDesktop(item,file){
  if(!await allowRepeatDownload(item))return;
  enqueueDesktopDownload(item,file);
}
async function sendDesktop(item,file){
  const config=loadFtp();
  if(!config.host){
    if(el.detailsDialog.open)el.detailsDialog.close();
    populateFtp();
    ftpDialog.showModal();
    setFtpStatus('Configure o IP antes de enviar.',false);
    return;
  }
  if(!startTransfer('Enviando '+file.name,undefined,{item,file}))return;
  try{
    const result=await window.desktop.sendToPs4(fileUrl(item,file),file.name,config);
    finishTransfer('Enviado para '+result.remotePath);
  }catch(error){failTransfer(error);offerOfficialDownload(item,file,error,'ps4')}
}

openDetails=function(id){
  const item=state.items.find(function(i){return i.id===id});if(!item)return;
  state.selected=id;const files=item.files||[];const primary=files.find(function(f){return f.source==='original'&&f.size})||files[0];
  const fileRows=files.length?files.slice(0,60).map(function(f,index){return '<div class="file-row"><span class="file-name" title="'+escapeHtml(f.name)+'">'+escapeHtml(f.name)+'</span><span class="file-size">'+formatBytes(f.size)+'</span><span class="file-actions"><button class="download-mini focusable" data-file="'+index+'">PC</button><button class="send-mini focusable" data-send="'+index+'">PS4</button></span></div>'}).join(''):'<p class="item-count">Nenhum arquivo público encontrado.</p>';
  el.details.innerHTML='<div class="details-backdrop" style="background-image:url('+escapeHtml(item.cover)+')"></div><button class="dialog-close focusable" data-close-details aria-label="Fechar">×</button><div class="details-body"><div><img class="details-cover" src="'+escapeHtml(item.cover)+'" alt="Capa de '+escapeHtml(item.title)+'"></div><div class="details-copy"><span class="dialog-kicker">'+typeLabel(item.type)+'</span><h2>'+escapeHtml(item.title)+'</h2><div class="details-meta"><span>'+escapeHtml(item.creator)+'</span>'+(item.date?'<span>·</span><span>'+escapeHtml(item.date)+'</span>':'')+'<span>·</span><span>'+files.length+' arquivos</span><span>·</span><span>'+formatBytes(item.totalSize)+'</span></div><p class="details-description">'+escapeHtml(item.description)+'</p><div class="details-actions">'+(primary?'<button class="pc-button focusable" data-primary-download>Baixar no PC · '+formatBytes(primary.size)+'</button><button class="ps4-button focusable" data-primary-send>Enviar ao PS4</button>':'')+'<button class="ghost-button focusable" data-original>Visualizar original</button><button class="danger-button focusable" data-remove>Remover</button></div><div class="files-title"><h3>Arquivos disponíveis</h3><span class="item-count">'+item.formats.slice(0,3).map(escapeHtml).join(' · ')+'</span></div><div class="files-list">'+fileRows+'</div></div></div>';
  el.detailsDialog.showModal();
  $('[data-close-details]',el.details).onclick=function(){closeDialog(el.detailsDialog)};
  $('[data-original]',el.details).onclick=function(){window.desktop.openExternal(item.detailsUrl)};
  if(primary){$('[data-primary-download]',el.details).onclick=function(){closeDialog(el.detailsDialog);downloadDesktop(item,primary)};$('[data-primary-send]',el.details).onclick=function(){closeDialog(el.detailsDialog);sendDesktop(item,primary)}}
  $$('[data-file]',el.details).forEach(function(button){button.onclick=function(){closeDialog(el.detailsDialog);downloadDesktop(item,files[Number(button.dataset.file)])}});
  $$('[data-send]',el.details).forEach(function(button){button.onclick=function(){closeDialog(el.detailsDialog);sendDesktop(item,files[Number(button.dataset.send)])}});
  $('[data-remove]',el.details).onclick=function(){if(confirm('Remover “'+item.title+'” do catálogo?')){state.items=state.items.filter(function(i){return i.id!==id});saveItems();render();closeDialog(el.detailsDialog);showToast('Item removido do catálogo.')}};
};

$('#openFtp').addEventListener('click',function(){populateFtp();setFtpStatus('',true);ftpDialog.showModal()});
$('#testFtp').addEventListener('click',async function(event){event.preventDefault();setFtpStatus('Conectando ao PS4…',true);try{const result=await window.desktop.testFtp(getFtpForm());setFtpStatus(result.message,true)}catch(error){setFtpStatus(error.message||'Não foi possível conectar.',false)}});
$('#saveFtp').addEventListener('click',function(event){event.preventDefault();const config=getFtpForm();if(!config.host){setFtpStatus('Informe o IP do PS4.',false);return}localStorage.setItem(FTP_KEY,JSON.stringify(config));populateFtp();ftpDialog.close();showToast('Configuração FTP salva.')});
$('#exportCatalog').addEventListener('click',async function(){const result=await window.desktop.exportCatalog({version:1,exportedAt:new Date().toISOString(),items:state.items});if(result&&result.ok)showToast('Catálogo exportado.')});
populateFtp();


