(function(){
  function githubCatalogUrl(input){
    try{
      const url=new URL(input.trim());
      if(url.protocol!=='https:'||url.username||url.password||url.port)return '';
      const parts=url.pathname.split('/').filter(Boolean);
      if(url.hostname==='github.com'&&parts.length>=5&&['blob','raw'].includes(parts[2])){
        parts.splice(2,1);
        return 'https://raw.githubusercontent.com/'+parts.join('/');
      }
      if(url.hostname==='raw.githubusercontent.com'&&parts.length>=4){
        if(parts[2]==='refs'&&parts[3]==='heads'&&parts[4]==='main')parts.splice(2,2);
        return 'https://raw.githubusercontent.com/'+parts.join('/');
      }
    }catch{}
    return '';
  }

  function publicHttps(input,base){
    if(typeof input!=='string'||!input.trim())return '';
    try {
      const url=new URL(input,base);
      const host=url.hostname;
      if(url.protocol!=='https:'||url.username||url.password||url.port||
         !host.includes('.')||host.endsWith('.local')||host.endsWith('.localhost')||
         /^\d[\d.]*$/.test(host)||host.includes(':'))return '';
      return url.href;
    }catch{return ''}
  }

  function parseGitCatalog(data,source,type,{allowEmpty=false}={}){
    const urlEntries=data?.DATA;
    const hasData=Boolean(data&&Object.hasOwn(data,'DATA'));
    if(hasData&&(!urlEntries||typeof urlEntries!=='object'||Array.isArray(urlEntries))){
      throw new Error('O campo DATA precisa ser um objeto com uma URL de download por chave.');
    }
    const top=hasData
      ?Object.entries(urlEntries).map(([url,fields])=>({...fields,url}))
      :Array.isArray(data)?data:data?.games??data?.items??data?.files??data?.downloads;
    if(!Array.isArray(top))throw new Error('O JSON precisa ter um objeto DATA com links ou uma lista games, items, files ou downloads.');
    if(!top.length){
      const file=decodeURIComponent(new URL(source).pathname.split('/').pop());
      if(allowEmpty)return {kind:'bundle',title:file,items:[],skipped:0};
      throw new Error(hasData
        ?file+' foi lido, mas DATA está vazio. Cole o link de um JSON que já contenha os jogos.'
        :file+' foi lido, mas a lista de itens está vazia.');
    }
    const catalogTitle=(!Array.isArray(data)&&typeof data.title==='string'&&data.title.trim())||
      source.split('/').slice(3,5).join('/')+' · '+source.split('/').at(-1);
    const entries=new Map();
    let skipped=0;
    for(const raw of top){
      const entry=typeof raw==='string'?{url:raw}:raw;
      if(!entry||typeof entry!=='object'){skipped++;continue}
      const nested=entry.files??entry.downloads??entry.links;
      const files=[];
      for(const rawFile of Array.isArray(nested)?nested:[entry]){
        const file=typeof rawFile==='string'?{url:rawFile}:rawFile;
        const link=file?.url??file?.downloadUrl??file?.download_url??file?.link??file?.download;
        const url=hasData?dataDownloadUrl(link):publicHttps(link,source);
        if(!url){skipped++;continue}
        let filename=file.filename??file.file_name??file.fileName??(file!==entry?file.name:undefined);
        if(typeof filename!=='string'||!filename.trim()){
          const leaf=new URL(url).pathname.split('/').pop();
          try{filename=decodeURIComponent(leaf)}catch{filename=leaf}
        }
        if(!filename||/[\/\\\x00-\x1f]/.test(filename)||['.','..'].includes(filename)){skipped++;continue}
        files.push({name:filename,url,size:Math.max(0,Number(file.size??file.bytes)||0),
          format:filename.split('.').pop().toUpperCase(),source:'original'});
      }
      if(!files.length)continue;
      const inferred=files[0].name.match(/^(.*?)\s*\[(CUSA\d{5})\]\s*\[([^\]]+)\]/i);
      const serial=String(entry.serial??entry.title_id??entry.titleId??inferred?.[2]??'').toUpperCase();
      const version=String(entry.version??inferred?.[3]??'');
      const region=String(entry.region??'').trim();
      const minFirmware=String(entry.min_fw??'').trim();
      const release=String(entry.release??entry.date??entry.year??'').trim();
      const title=String(entry.title??entry.game_title??entry.game??entry.name??inferred?.[1]??
        files[0].name.replace(/(?:\.part\d+\.rar|\.(?:zip|7z)\.\d+|\.[^.]+)$/i,'')).trim();
      if(!title){skipped++;continue}
      const key=JSON.stringify([entry.id??serial,title.toLowerCase(),version,region,
        urlEntries&&files[0].name.toLowerCase().endsWith('.pkg')?files[0].url:'']);
      let item=entries.get(key);
      if(!item){
        const cover=publicHttps(entry.cover??entry.cover_url??entry.image,source);
        item={
          id:source+'::'+key,sourceId:source,title,creator:[serial,version?'v'+version:''].filter(Boolean).join(' · '),
          serial,version,region,minFirmware,release,
          platformHints:entry.platform??entry.platforms??entry.system??entry.console,
          emulationTargets:entry.emulates??entry.emulated_systems??entry.emulationTargets,
          contentKind:entry.content_type??entry.kind,
          date:release.match(/\b(?:19|20)\d{2}\b/)?.[0]||'',
          description:typeof entry.description==='string'?entry.description:'',
          type:type==='auto'?'jogos':type,cover,catalogCover:Boolean(cover),
          detailsUrl:source,files:[],addedAt:Date.now()
        };
        entries.set(key,item);
      }
      const fileMap=new Map(item.files.map(file=>[file.name,file]));
      for(const file of files)fileMap.set(file.name,file);
      item.files=[...fileMap.values()];
      item.totalSize=item.files.reduce((sum,file)=>sum+file.size,0);
      item.formats=[...new Set(item.files.map(file=>file.format))];
    }
    if(!entries.size)throw new Error('Nenhum link direto HTTPS válido foi encontrado no JSON. Identificadores de outros serviços precisam de uma URL de download.');
    return {kind:'bundle',title:catalogTitle,items:[...entries.values()],skipped};
  }

  function dataDownloadUrl(value){
    const direct=publicHttps(value);
    if(direct)return direct;
    if(typeof value!=='string'||value.length>16384||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))return '';
    try{return publicHttps(atob(value))}catch{return ''}
  }

  function isLegacyPlaceholder(item){
    const source=githubCatalogUrl(item.sourceId||'');
    return source==='https://raw.githubusercontent.com/Dinos17/FPKGi-Catalog-Hub/main/ps4/games.json'&&
      item.files?.length>0&&item.files.every(file=>/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(file.name)
        &&file.url===publicHttps(file.name,source));
  }

  function ps4Catalog(items){
    const packages=new Map();
    for(const item of items){
      if(item.type!=='jogos'||!githubCatalogUrl(item.sourceId||''))continue;
      for(const file of item.files||[]){
        const url=publicHttps(file.url);
        if(!url||!/\.pkg$/i.test(file.name))continue;
        const entry={name:item.title,size:Math.max(0,Number(file.size)||0)};
        if(item.serial)entry.title_id=item.serial;
        if(item.region)entry.region=item.region;
        if(item.version)entry.version=item.version;
        if(item.release)entry.release=item.release;
        if(item.minFirmware&&Number.isFinite(Number(item.minFirmware)))entry.min_fw=Number(item.minFirmware);
        const cover=publicHttps(item.cover);
        if(cover)entry.cover_url=cover;
        packages.set(url,entry);
      }
    }
    return {DATA:Object.fromEntries(packages)};
  }

  const api={githubCatalogUrl,parseGitCatalog,publicHttps,ps4Catalog,isLegacyPlaceholder};
  if(typeof module!=='undefined')module.exports=api;
  else globalThis.gitCatalog=api;
})();

