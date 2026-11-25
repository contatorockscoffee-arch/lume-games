const sourcesKey='meu-acervo-sources-v1';
const sources=new Map();
try{
  for(const source of JSON.parse(localStorage.getItem(sourcesKey))||[]){
    const id=gitCatalog.githubCatalogUrl(source.id)||source.id;
    sources.set(id,{...source,id});
  }
}catch{}

function sourceId(item){return item.sourceId||item.archiveId||item.id}
function sourceUrl(id){return gitCatalog.githubCatalogUrl(id)||'https://archive.org/metadata/'+encodeURIComponent(id)}
const normalizedItems=new Map();
for(const item of state.items){
  const canonical=gitCatalog.githubCatalogUrl(item.sourceId||'');
  const normalized=canonical&&canonical!==item.sourceId
    ?{...item,id:canonical+item.id.slice(item.sourceId.length),sourceId:canonical}:item;
  normalizedItems.set(normalized.id,mergeSourceItem(normalizedItems.get(normalized.id),normalized));
}
if(state.items.some(item=>normalizedItems.get(item.id)!==item)){
  state.items=[...normalizedItems.values()];
  try{saveItems()}catch{}
}
for(const item of state.items){
  const id=sourceId(item);
  if(!sources.has(id))sources.set(id,{id,title:item.virtual?id:item.title,type:'auto'});
}
function saveSources(){localStorage.setItem(sourcesKey,JSON.stringify([...sources.values()]))}

function mergeSourceItem(previous,incoming){
  if(!previous)return incoming;
  const byName=new Map((previous.files||[]).map(file=>[file.name,file]));
  for(const file of incoming.files)byName.set(file.name,file);
  const files=[...byName.values()];
  return {
    ...previous,...incoming,files,addedAt:previous.addedAt,
    totalSize:files.reduce((sum,file)=>sum+(Number(file.size)||0),0),
    formats:[...new Set(files.map(file=>file.format).filter(Boolean))],
    ...(previous.providerId?{
      cover:incoming.catalogCover?incoming.cover:previous.cover,
      description:incoming.description||previous.description,date:incoming.date||previous.date
    }:{})
  };
}

let sourceBusy=false;
async function synchronizeSource(id,type,{deferRender=false}={}){
  if(sourceBusy)throw new Error('Aguarde a sincronização em andamento.');
  sourceBusy=true;
  try{
    const jsonUrl=gitCatalog.githubCatalogUrl(id);
    const source=sources.get(id);
    const response=jsonUrl
      ?gitCatalog.parseGitCatalog(await window.desktop.readGithubCatalog(jsonUrl),jsonUrl,type,{allowEmpty:source?.isDefault===true})
      :await fetchArchiveItem(id,type);
    const incoming=response.kind==='bundle'?response.items:[response];
    const current=new Map(state.items.map(item=>[item.id,item]));
    if(response.kind==='bundle')current.delete(id);
    for(const item of incoming){
      const legacyId=item.serial?id+'::'+item.serial:'';
      const legacy=current.get(legacyId);
      const sameVersion=legacy&&legacy.version===item.version&&Number(legacy.dlc||0)===Number(item.dlc||0);
      if(sameVersion)current.delete(legacyId);
      current.set(item.id,mergeSourceItem(current.get(item.id)||(sameVersion?legacy:null),item));
    }
    const items=[...current.values()].sort((a,b)=>b.addedAt-a.addedAt);
    if(incoming.length){
      localStorage.setItem(STORAGE_KEY,JSON.stringify(items));
      state.items=items;
    }
    sources.set(id,{...source,id,title:source?.isDefault?source.title:response.title||id,type,
      count:incoming.length,syncedAt:Date.now()});
    saveSources();
    if(!deferRender){render();renderSources()}
    return {count:incoming.length,skipped:response.skipped||0};
  }finally{sourceBusy=false}
}

async function importCatalogSource(){
  if(el.importButton.disabled)return;
  const id=gitCatalog.githubCatalogUrl(el.input.value)||parseIdentifier(el.input.value);
  if(!id){el.status.textContent='Informe um link do Archive ou para o JSON público no GitHub.';return}
  el.importButton.classList.add('loading');
  el.importButton.disabled=true;
  el.status.textContent='Lendo a fonte do catálogo…';
  try{
    const {count,skipped}=await synchronizeSource(id,$('input[name="mediaType"]:checked').value);
    el.form.reset();
    el.importDialog.close();
    showToast(count+' opções lidas.'+(skipped?' '+skipped+' registros ou links inválidos ignorados.':''));
  }catch(error){el.status.textContent=metadataError(error)}
  finally{el.importButton.classList.remove('loading');el.importButton.disabled=false}
}

function renderSources(){
  const list=$('#sourceList');
  $('#sourceCount').textContent=sources.size+' '+(sources.size===1?'link':'links');
  list.replaceChildren();
  if(!sources.size){list.textContent='Nenhum link adicionado.';return}
  for(const source of sources.values()){
    const row=document.createElement('div');
    row.className='source-row';
    const info=document.createElement('div');
    const label=document.createElement('strong');
    label.textContent=source.title;
    const url=document.createElement('a');
    url.href=sourceUrl(source.id);
    url.textContent=url.href;
    url.onclick=event=>{event.preventDefault();window.desktop.openExternal(url.href)};
    info.append(label,url);
    if(source.isDefault){
      const status=document.createElement('small');
      status.className='item-count';
      status.textContent=source.syncedAt?(source.count?source.count+' entradas':'Sem entradas na fonte'):'Ainda não consultada';
      info.append(status);
    }
    const button=document.createElement('button');
    button.type='button';
    button.className='ghost-button focusable';
    button.textContent='Sincronizar';
    button.setAttribute('aria-label','Sincronizar '+source.title);
    button.onclick=async()=>{
      if(sourceBusy)return;
      const status=$('#sourceStatus');
      status.textContent='Sincronizando '+source.title+'…';
      button.disabled=true;
      try{
        const {count,skipped}=await synchronizeSource(source.id,source.type);
        status.textContent=count+' opções lidas de '+source.title+'.'+(skipped?' '+skipped+' registros ou links inválidos ignorados.':'');
        refreshMetadata();
      }catch(error){status.textContent=metadataError(error)}
      finally{button.disabled=false}
    };
    row.append(info,button);
    list.append(row);
  }
}
$('#openSettings').addEventListener('click',renderSources);
$('#addSource').onclick=()=>{settingsDialog.close();openImport()};
let syncingDefaults=false;
async function syncDefaultSources(force=false){
  if(syncingDefaults||sourceBusy)return;
  const registered=[...sources.values()].filter(source=>source.isDefault&&(force||!source.syncedAt));
  if(!registered.length)return;
  const button=$('#syncDefaultSources'),status=$('#sourceStatus');
  syncingDefaults=true;
  button.disabled=true;
  let completed=0,failed=0;
  try{
    for(const source of registered){
      status.textContent='Consultando '+source.title+'…';
      try{await synchronizeSource(source.id,source.type,{deferRender:true});completed++}
      catch{failed++}
    }
    status.textContent=completed+' fontes consultadas.'+(failed?' '+failed+' indisponíveis.':'');
  }finally{
    syncingDefaults=false;
    button.disabled=false;
    render();
    renderSources();
    refreshMetadata();
  }
}
function registerDefaultSources(){
  for(const [name,id] of Object.entries(globalThis.defaultCatalogFeeds||{})){
    const previous=sources.get(id);
    sources.set(id,{...previous,id,title:name,type:previous?.type||'auto',isDefault:true});
  }
  try{saveSources()}catch{}
}
$('#syncDefaultSources').onclick=()=>syncDefaultSources(true);
$('#exportPs4Catalog').onclick=async()=>{
  const catalog=gitCatalog.ps4Catalog(state.items);
  const count=Object.keys(catalog.DATA).length;
  const status=$('#sourceStatus');
  if(!count){status.textContent='Adicione um catálogo do GitHub com arquivos .pkg para exportar.';return}
  try{
    const result=await window.desktop.exportPs4Catalog(catalog);
    if(result.ok)status.textContent=count+' links PKG do GitHub exportados para o PS4.';
  }catch(error){status.textContent=metadataError(error)}
};

function sameGame(a,b){
  if(a.id===b.id)return true;
  if(a.type!=='jogos'||b.type!=='jogos')return false;
  const title=matchTitle(a.providerTitle||a.title);
  return Boolean(a.serial&&a.serial===b.serial)||Boolean(title&&title===matchTitle(b.providerTitle||b.title))
    || Boolean(matchTitle(a.title)&&matchTitle(a.title)===matchTitle(b.title));
}

const catalogMatches=filteredItems;
const sourceFilter=$('#catalogSourceFilter');
const platformFilter=$('#catalogPlatform');
const contentFilter=$('#catalogContent');
const targetFilter=$('#catalogTarget');
const platformCache=new WeakMap();
function platformOf(item){
  if(!platformCache.has(item))platformCache.set(item,catalogPlatforms.classify(item));
  return platformCache.get(item);
}
function setFacetOptions(control,choices,labels){
  const selected=control.value;
  control.replaceChildren(new Option('Todos','all'));
  for(const [key,label] of Object.entries(labels)){
    if(choices.has(key))control.add(new Option(label,key));
  }
  control.value=choices.has(selected)?selected:'all';
}
function updatePlatformFilters(){
  const platforms=new Set(),kinds=new Set(),targets=new Set();
  for(const item of state.items.filter(matchesSource)){
    const info=platformOf(item);
    for(const key of info.platforms)platforms.add(key);
    if(info.kind)kinds.add(info.kind);
    for(const key of info.targets)targets.add(key);
    if(info.kind==='emulator'&&!info.targets.length)targets.add('unknown');
  }
  setFacetOptions(platformFilter,platforms,catalogPlatforms.labels);
  setFacetOptions(contentFilter,kinds,catalogPlatforms.contents);
  setFacetOptions(targetFilter,targets,catalogPlatforms.labels);
  $('#emulatorFilterLabel').hidden=!targets.size;
}

function matchesSource(item){
  if(gitCatalog.isLegacyPlaceholder(item))return false;
  if(sourceFilter.value==='all')return true;
  const kind=gitCatalog.githubCatalogUrl(item.sourceId||'')?'github':'archive';
  return kind===sourceFilter.value;
}
function matchesFacets(item){
  if(!matchesSource(item))return false;
  const info=platformOf(item);
  return (platformFilter.value==='all'||info.platforms.includes(platformFilter.value))&&
    (contentFilter.value==='all'||info.kind===contentFilter.value)&&
    (targetFilter.value==='all'||info.targets.includes(targetFilter.value)||
      (targetFilter.value==='unknown'&&info.kind==='emulator'&&!info.targets.length));
}
for(const control of [sourceFilter,platformFilter,contentFilter,targetFilter]){
  control.addEventListener('change',()=>render());
}
filteredItems=function(){
  const items=catalogMatches().filter(matchesFacets);
  const roots=items.map((_item,index)=>index),keys=new Map();
  function root(index){
    while(roots[index]!==index){roots[index]=roots[roots[index]];index=roots[index]}
    return index;
  }
  for(const [index,item] of items.entries()){
    if(item.type!=='jogos')continue;
    const title=matchTitle(item.title),preferred=matchTitle(item.providerTitle||item.title);
    const candidates=[['serial',item.serial],['title',title],['preferred',preferred]];
    for(const [type,value] of candidates){
      if(!value)continue;
      const key=type+':'+value;
      if(keys.has(key))roots[root(index)]=root(keys.get(key));
      else keys.set(key,index);
    }
  }
  const groups=new Map();
  for(const [index,item] of items.entries()){
    const key=root(index);
    const existing=groups.get(key);
    if(!existing||(item.providerId&&item.cover&&!(existing.providerId&&existing.cover)))groups.set(key,item);
  }
  return [...groups.values()];
};

const renderPlatformCards=render;
render=function(){
  updatePlatformFilters();
  renderPlatformCards();
  const items=new Map(state.items.map(item=>[item.id,item]));
  for(const card of $$('.media-card',el.grid)){
    const entry=items.get(card.dataset.id);
    const info=platformOf(entry);
    if(info.platforms.length){
      const label=info.platforms.map(key=>catalogPlatforms.labels[key]).join(' · ');
      const kind=info.kind==='game'?'':catalogPlatforms.contents[info.kind];
      $('.card-type',card).textContent=[label,kind].filter(Boolean).join(' · ');
    }
  }
  syncTransferCards();
};

const variantDetails=openDetails;
openDetails=function(id){
  const item=state.items.find(candidate=>candidate.id===id);
  if(!item)return;
  variantDetails(id);
  const info=platformOf(item);
  if(info.platforms.length||item.region||item.minFirmware||item.release){
    const metadata=document.createElement('p');
    metadata.className='details-meta';
    const targets=info.targets.map(key=>catalogPlatforms.labels[key]).join(', ');
    metadata.textContent=[info.platforms.map(key=>catalogPlatforms.labels[key]).join(', '),
      targets?'Emula '+targets:'',item.region,item.minFirmware?'Firmware mínimo '+item.minFirmware:'',
      item.release?'Lançamento '+item.release:''].filter(Boolean).join(' · ');
    $('.details-actions',el.details).before(metadata);
  }
  const variants=state.items.filter(candidate=>matchesFacets(candidate)&&sameGame(item,candidate));
  if(variants.length<2)return;
  const label=document.createElement('label');
  label.className='compact-field settings-field';
  label.append('Opção de download');
  const select=document.createElement('select');
  select.className='variant-select focusable';
  for(const variant of variants){
    const source=sources.get(sourceId(variant));
    const text=[source?.title||sourceId(variant),platformOf(variant).platforms.map(key=>catalogPlatforms.labels[key]).join(', '),
      variant.version?'v'+variant.version:'',variant.region,
      variant.dlc?variant.dlc+' DLC':'',variant.serial,formatBytes(variant.totalSize)].filter(Boolean);
    select.add(new Option(text.join(' · '),variant.id));
  }
  select.value=id;
  select.onchange=()=>{
    const next=select.value;
    el.detailsDialog.close();
    openDetails(next);
    $('.variant-select',el.details)?.focus();
  };
  label.append(select);
  $('.details-actions',el.details).before(label);
};

registerDefaultSources();
render();
if(window.desktop.readGithubCatalog&&globalThis.defaultCatalogFeeds){
  setTimeout(()=>syncDefaultSources(false),0);
}

