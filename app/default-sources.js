(function(){
  const root='https://raw.githubusercontent.com/Dinos17/FPKGi-Catalog-Hub/main/ps4/';
  const names={PS1:'ps1',PS2:'ps2',PSP:'psp',games:'games',apps:'apps',updates:'updates',
    DLC:'dlc',demos:'demos',homebrew:'homebrew',emulators:'emulators',themes:'themes'};
  const feeds=Object.fromEntries(Object.entries(names).map(([name,file])=>[name,root+file+'.json']));
  if(typeof module!=='undefined')module.exports=feeds;
  else globalThis.defaultCatalogFeeds=feeds;
})();

