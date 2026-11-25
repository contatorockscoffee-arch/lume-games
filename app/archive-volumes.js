function volumeInfo(name) {
  let match = name.match(/^(.*)\.part(\d+)\.rar$/i);
  if (match) return {key: match[1]+'.part.rar', number:Number(match[2])};
  match = name.match(/^(.*\.(?:7z|zip))\.(\d{3,})$/i);
  if (match) return {key:match[1]+'.split', number:Number(match[2])};
  match = name.match(/^(.*)\.r(\d{2,})$/i);
  if (match) return {key:match[1]+'.rar', number:Number(match[2])+2};
  if (/\.rar$/i.test(name)) return {key:name, number:1};
  return null;
}

function archiveVolumes(files, selected) {
  const volume=volumeInfo(selected.name);
  if (!volume) return /\.(zip|7z)$/i.test(selected.name)?[selected.name]:null;
  const entries=files.map(file=>({name:file.name,info:volumeInfo(file.name)}))
    .filter(entry=>entry.info?.key.toLowerCase()===volume.key.toLowerCase())
    .sort((a,b)=>a.info.number-b.info.number);
  if(entries.some((entry,index)=>entry.info.number!==index+1)){
    throw new Error('Há volumes faltando ou duplicados na lista do Archive.');
  }
  return entries.map(entry=>entry.name);
}

if(typeof module!=='undefined')module.exports={archiveVolumes};

