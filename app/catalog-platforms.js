(function(){
  const labels={
    ps1:'PS1',ps2:'PS2',ps3:'PS3',ps4:'PS4',ps5:'PS5',psp:'PSP',vita:'PS Vita',
    nes:'NES / Famicom',snes:'Super Nintendo',n64:'Nintendo 64',gc:'GameCube',
    wii:'Wii',wiiu:'Wii U',switch:'Nintendo Switch',gb:'Game Boy',gbc:'Game Boy Color',
    gba:'Game Boy Advance',nds:'Nintendo DS',n3ds:'Nintendo 3DS',sms:'Master System',
    gg:'Game Gear',md:'Mega Drive / Genesis',saturn:'Sega Saturn',dc:'Dreamcast',
    xbox:'Xbox',x360:'Xbox 360',xone:'Xbox One',xs:'Xbox Series',arcade:'Arcade',
    neogeo:'Neo Geo',pce:'PC Engine',a2600:'Atari 2600',pc:'PC',multi:'Vários sistemas',
    unknown:'Não identificado'
  };
  const patterns={
    ps1:/\bps[ -]?(?:one|x|1)\b|\bplaystation(?:\s+(?:one|1))?\b(?!\s+(?:[2-5]|portable|vita|vr)\b)/,
    ps2:/\bps[ -]?2\b|\bplaystation\s*2\b/,ps3:/\bps[ -]?3\b|\bplaystation\s*3\b/,
    ps4:/\bps[ -]?4\b|\bplaystation\s*4\b/,ps5:/\bps[ -]?5\b|\bplaystation\s*5\b/,
    psp:/\bpsp\b|\bplaystation portable\b/,vita:/\bps vita\b|\bplaystation vita\b/,
    snes:/\bsnes\b|\bsuper (?:nintendo|famicom)\b/,nes:/\bnes\b|(?<!super )\bfamicom\b/,
    n64:/\bn64\b|\bnintendo 64\b/,gc:/\bgamecube\b/,wiiu:/\bwii u\b/,wii:/\bwii\b(?! u\b)/,
    switch:/\bnintendo switch\b/,gbc:/\bgbc\b|\bgame boy color\b/,gba:/\bgba\b|\bgame boy advance\b/,
    gb:/\bgame boy\b(?! (?:color|advance)\b)/,n3ds:/\b3ds\b/,nds:/\bnds\b|\bnintendo ds\b/,
    sms:/\bmaster system\b/,gg:/\bgame gear\b/,md:/\bmega drive\b|\bsega genesis\b|\bgenesis\b/,
    saturn:/\bsega saturn\b/,dc:/\bdreamcast\b/,x360:/\bxbox 360\b/,xone:/\bxbox one\b/,
    xs:/\bxbox series\b/,xbox:/\bxbox\b(?! (?:360|one|series)\b)/,
    arcade:/\barcade\b|\bmame\b/,neogeo:/\bneo geo\b/,pce:/\bpc engine\b|\bturbografx\b/,
    a2600:/\batari 2600\b/,pc:/\bwindows\b|\bms dos\b|\bpc\b(?! engine\b)/
  };
  const romExtensions={
    nes:'nes',fds:'nes',sfc:'snes',smc:'snes',z64:'n64',n64:'n64',v64:'n64',wbfs:'wii',
    wud:'wiiu',wux:'wiiu',nsp:'switch',xci:'switch',gb:'gb',gbc:'gbc',gba:'gba',
    nds:'nds','3ds':'n3ds',sms:'sms',gg:'gg',md:'md',gen:'md',smd:'md',
    gdi:'dc',pce:'pce',a26:'a2600'
  };
  const emulatorNames=[
    [/\b(?:retroarch|bizhawk|mednafen|ares)\b/,['multi']],
    [/\b(?:epsxe|duckstation|pcsx rearmed|pcsx redux)\b/,['ps1']],
    [/\bpcsx2\b/,['ps2']],[/\brpcs3\b/,['ps3']],[/\bppsspp\b/,['psp']],
    [/\bvita3k\b/,['vita']],[/\b(?:nestopia|fceux|pnes)\b/,['nes']],
    [/\b(?:snes9x|bsnes|psnes)\b/,['snes']],[/\b(?:mupen64plus|project64)\b/,['n64']],
    [/\bdolphin\b/,['gc','wii']],[/\bcemu\b/,['wiiu']],
    [/\b(?:mgba|visualboyadvance)\b/,['gb','gbc','gba']],
    [/\b(?:melonds|desmume)\b/,['nds']],[/\b(?:citra|azahar)\b/,['n3ds']],
    [/\b(?:pgen|genesis plus gx)\b/,['md','sms','gg']],
    [/\b(?:flycast|redream)\b/,['dc']],
    [/\b(?:mame|fbalpha|fbneo|final burn neo|pfbn)\b/,['arcade']]
  ];
  const contents={game:'Jogos',emulator:'Emuladores',homebrew:'Homebrew',dlc:'DLC',update:'Atualizações',
    app:'Aplicativos',demo:'Demos',theme:'Temas'};
  function normalize(value){
    return String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
      .replace(/[_/.-]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function list(value){return Array.isArray(value)?value:value?[value]:[]}
  function findPlatforms(values){
    const found=new Set();
    for(const value of list(values).flat(2)){
      const text=normalize(value);
      for(const [key,regex] of Object.entries(patterns))if(regex.test(text))found.add(key);
    }
    return [...found];
  }
  function classify(item){
    if(item.type!=='jogos')return {platforms:[],targets:[],kind:''};
    const source=item.sourceId||item.archiveId||item.id||'';
    const path=source.split(/[?#]/)[0].split('/');
    const section=normalize((path.at(-1)||'').replace(/\.json$/i,''));
    const serial=String(item.serial||item.creator||'').toUpperCase();
    const hints=item.platformHints||[];
    const emulator=emulatorNames.find(([test])=>test.test(normalize(item.title)));
    const explicitKind=normalize(item.contentKind);
    const bySection={emulators:'emulator',emuladores:'emulator',homebrew:'homebrew',dlc:'dlc',
      updates:'update',apps:'app',demos:'demo',themes:'theme'};
    const kind=(
      emulator||['emulator','emulador','emulators','emuladores'].includes(explicitKind)||bySection[section]==='emulator'||list(item.emulationTargets).length
    )?'emulator':(contents[explicitKind]?explicitKind:bySection[section])||'game';
    const targets=[...new Set([...findPlatforms(item.emulationTargets),...(emulator?.[1]||[])])];
    const explicit=findPlatforms(hints);
    if(explicit.length)return {platforms:explicit,targets,kind};
    const sectionPlatform=findPlatforms(section);
    if(sectionPlatform.length===1)return {platforms:sectionPlatform,targets,kind};
    let serialPlatform='';
    if(/\b(CUSA)\d{5}/.test(serial))serialPlatform='ps4';
    else if(/\b(PPSA)\d{5}/.test(serial))serialPlatform='ps5';
    else if(/\b(?:BLES|BLUS|BLAS|BLJM|BCES|BCUS|BCAS|BCJS|NPUB|NPEB|NPJB)\d{5}/.test(serial))serialPlatform='ps3';
    else if(/\b(?:ULUS|ULES|ULJM|ULJS|UCUS|UCES|NPJH)\d{5}/.test(serial))serialPlatform='psp';
    else if(/\b(?:PCSA|PCSB|PCSE|PCSG|PCSF|PCSH)\d{5}/.test(serial))serialPlatform='vita';
    if(serialPlatform)return {platforms:[serialPlatform],targets,kind};
    const parent=path.length>1?findPlatforms(path.at(-2)):[];
    if(parent.length===1)return {platforms:parent,targets,kind};
    const fromFiles=new Set();
    for(const file of item.files||[]){
      const name=file.name||'';
      const extension=name.split('.').pop().toLowerCase();
      if(romExtensions[extension])fromFiles.add(romExtensions[extension]);
      for(const match of name.matchAll(/[\[(]([^\])]+)[\])]/g)){
        for(const platform of findPlatforms(match[1]))fromFiles.add(platform);
      }
    }
    const fromSource=findPlatforms([source,...list(item.platformTags)]);
    const platforms=fromFiles.size?[...fromFiles]:fromSource;
    return {platforms:platforms.length?platforms:['unknown'],targets,kind};
  }
  const api={labels,contents,classify};
  if(typeof module!=='undefined')module.exports=api;
  else globalThis.catalogPlatforms=api;
})();

