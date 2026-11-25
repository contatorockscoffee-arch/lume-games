// Optional Lume account. This module deliberately stores no Archive cookie,
// password or download history. It only remembers an API endpoint and a local
// bearer token issued by the independent Lume service.
(()=>{
  const storageKey='lume-account-v1';
  const $=selector=>document.querySelector(selector);
  const status=$('#lumeAccountStatus'), apiInput=$('#lumeApiUrl'), emailInput=$('#lumeAccountEmail'), passwordInput=$('#lumeAccountPassword');
  if(!status||!apiInput)return;
  let account={};
  try{account=JSON.parse(localStorage.getItem(storageKey))||{}}catch{}
  const normalize=url=>String(url||'').trim().replace(/\/$/,'');
  const save=()=>localStorage.setItem(storageKey,JSON.stringify(account));
  const setStatus=message=>{status.textContent=message};
  const request=async(path,options={})=>{
    const base=normalize(apiInput.value||account.apiUrl);
    if(!/^https?:\/\//i.test(base))throw new Error('Informe o endereço HTTPS do serviço Lume.');
    const response=await fetch(base+path,{...options,headers:{'content-type':'application/json',...(account.token?{authorization:'Bearer '+account.token}:{}),...(options.headers||{})}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Não foi possível concluir a operação.');
    return data;
  };
  async function refresh(){
    apiInput.value=account.apiUrl||'';
    emailInput.value=account.email||'';
    if(!account.apiUrl||!account.token){setStatus(account.apiUrl?'Entre para conectar a conta.':'Conta não conectada.');return}
    try{const result=await request('/me');account.email=result.user.email;save();emailInput.value=account.email;setStatus('Conectado como '+account.email+'.')}
    catch{delete account.token;save();setStatus('A sessão expirou. Entre novamente.');}
  }
  async function authenticate(route){
    const email=emailInput.value.trim(),password=passwordInput.value;
    account.apiUrl=normalize(apiInput.value);save();
    try{setStatus(route==='login'?'Entrando…':'Criando conta…');const result=await request('/auth/'+route,{method:'POST',body:JSON.stringify({email,password}),headers:{}});account.token=result.token;account.email=result.user.email;save();passwordInput.value='';setStatus('Conectado como '+account.email+'.')}
    catch(error){setStatus(error.message)}
  }
  $('#lumeAccountLogin').addEventListener('click',()=>authenticate('login'));
  $('#lumeAccountRegister').addEventListener('click',()=>authenticate('register'));
  $('#lumeAccountLogout').addEventListener('click',()=>{delete account.token;save();passwordInput.value='';setStatus('Sessão encerrada neste computador.');});
  document.querySelector('#settingsDialog')?.addEventListener('open',refresh);
  refresh();
})();

