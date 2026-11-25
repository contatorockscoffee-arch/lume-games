const {setTimeout:delay}=require('node:timers/promises');
const ROOT='https://en.wikipedia.org';
const headers={'User-Agent':'MeuAcervo/1.2.1 (personal desktop game catalog)'};

function retryDelay(header,now){
  if(header&&/^\d+$/.test(header))return Math.max(5000,Number(header)*1000);
  const date=Date.parse(header||'');
  return Number.isFinite(date)?Math.max(5000,date-now):60000;
}

function createWikiLookup({fetcher=fetch,wait=delay,now=Date.now}={}){
  let queue=Promise.resolve();
  let nextRequest=0;
  let retryAt=0;
  const cache=new Map();

  async function lookup(title){
    const key=title.trim().toLowerCase();
    if(!key)return [];
    const previous=cache.get(key);
    if(previous&&previous.expires>now())return previous.games;
    if(retryAt>now())return {retryAt};
    if(nextRequest>now())await wait(nextRequest-now());
    nextRequest=now()+6500;

    const query=new URLSearchParams({
      action:'query',format:'json',formatversion:'2',generator:'search',
      gsrsearch:title,gsrnamespace:'0',gsrlimit:'8',prop:'pageimages|pageterms',
      wbptterms:'description',pilicense:'any',piprop:'thumbnail',pithumbsize:'360',pilimit:'8',
      maxlag:'5'
    });
    const response=await fetcher(ROOT+'/w/api.php?'+query,{headers,signal:AbortSignal.timeout(12000)});
    if(response.status===429||response.status===503){
      retryAt=now()+retryDelay(response.headers.get('Retry-After'),now());
      return {retryAt};
    }
    if(!response.ok)throw new Error('A fonte de capas está indisponível (HTTP '+response.status+').');
    const result=await response.json();
    if(result.error?.code==='maxlag'||result.error?.code==='ratelimited'){
      retryAt=now()+retryDelay(response.headers.get('Retry-After'),now());
      return {retryAt};
    }
    if(result.error)throw new Error('A Wikipédia não conseguiu completar a consulta.');
    const games=[];
    for(const page of (result.query?.pages||[]).sort((a,b)=>a.index-b.index)){
      const description=page.terms?.description?.[0]||'';
      if(!/\b(?:video game|videogame|arcade game)\b/i.test(description)||
         /\b(?:developer|publisher|designer|series|franchise)\b/i.test(description.split(' developed ')[0]))continue;
      const cover=page.thumbnail?.source||'';
      games.push({
        id:'wiki:'+page.pageid,
        title:page.title.replace(/\s*\((?:(?:19|20)\d{2} )?video game\)$/i,''),
        date:description.match(/\b(?:19|20)\d{2}\b/)?.[0]||'',
        description,platform:'Wikipédia',
        sourceUrl:ROOT+'/wiki/'+encodeURIComponent(page.title.replace(/ /g,'_')),
        cover:/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//i.test(cover)?cover:''
      });
    }
    if(cache.size>=1000)cache.delete(cache.keys().next().value);
    cache.set(key,{games,expires:now()+30*60*1000});
    return games;
  }

  return title=>{
    const pending=queue.then(()=>lookup(title));
    queue=pending.catch(()=>{});
    return pending;
  };
}

module.exports={lookupWikiGames:createWikiLookup(),createWikiLookup};

