/* Supabase Auth and Data API. Secrets and passwords are never stored here. */
(() => {
  'use strict';
  const key='lumo-session-v2',cfg=LumoConfig;
  let session=null,refreshing=null;
  try{session=JSON.parse(localStorage.getItem(key)||'null');}catch{}
  const messages={INVALID_LINK:'Ce lien n’est plus valide. Demandez le nouveau lien au coach.',INVALID_INVITE_CODE:'Ce lien d’invitation est invalide ou a expiré. Demandez un nouveau lien au club.',ACCESS_DENIED:'Votre compte ne permet pas cette action. Contactez l’administrateur du club.',AUTH_REQUIRED:'Reconnectez-vous pour continuer.',REVISION_CONFLICT:'Une autre personne vient de modifier ces informations.',INVALID_PAYLOAD:'Ces informations sont incohérentes. Vérifiez les places et les participants.',OVERBOOKED:'Il n’y a plus assez de places pour cette réservation.'};
  function friendly(raw){for(const [code,text] of Object.entries(messages))if(raw.includes(code))return text;if(/Invalid login credentials/i.test(raw))return 'Email ou mot de passe incorrect.';if(/Email not confirmed/i.test(raw))return 'Confirmez votre adresse avec le mail reçu, puis reconnectez-vous.';if(/rate limit/i.test(raw))return 'Trop de demandes récentes. Patientez quelques minutes avant de réessayer.';return raw;}
  function keep(value){session=value?.access_token?{...value,expires_at:Date.now()+Number(value.expires_in||3600)*1000}:null;if(session)localStorage.setItem(key,JSON.stringify(session));else localStorage.removeItem(key);return session;}
  async function request(path,{method='GET',body,anonymous=false,retry=true}={}){
    if(!anonymous)await refresh();
    const headers={apikey:cfg.publishableKey,'Content-Type':'application/json'};
    if(!anonymous){if(!session)throw Object.assign(new Error('Connectez-vous pour continuer.'),{code:'AUTH_REQUIRED'});headers.Authorization='Bearer '+session.access_token;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
    try{
      const res=await fetch(cfg.supabaseUrl+path,{method,headers,signal:controller.signal,...(body!==undefined?{body:JSON.stringify(body)}:{})});
      const data=await res.json().catch(()=>null);
      if(res.status===401&&!anonymous&&retry){await refresh(true);return request(path,{method,body,retry:false});}
      if(!res.ok){const raw=data?.message||data?.msg||data?.error_description||data?.error||'Le service est momentanément indisponible.';throw Object.assign(new Error(friendly(String(raw))),{code:data?.code||String(raw),status:res.status});}
      return data;
    }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Object.assign(new Error('Connexion indisponible. Vos modifications restent sur cet appareil.'),{offline:true});throw e;}finally{clearTimeout(timer);}
  }
  async function refresh(force=false){
    if(!session)return;if(!force&&session.expires_at>Date.now()+60000)return;
    if(!refreshing)refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},anonymous:true}).then(keep).catch(e=>{if(!e.offline)keep(null);throw e;}).finally(()=>refreshing=null);
    return refreshing;
  }
  async function signIn(email,password){const value=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},anonymous:true});return keep(value);}
  async function signUp(email,password,name){const value=await request('/auth/v1/signup?redirect_to='+encodeURIComponent(cfg.siteUrl),{method:'POST',body:{email,password,data:{display_name:name}},anonymous:true});if(value.access_token)keep(value);return value;}
  async function sendLink(email){await request('/auth/v1/otp?redirect_to='+encodeURIComponent(cfg.siteUrl),{method:'POST',body:{email,create_user:true},anonymous:true});}
  async function verifyCode(email,token){const value=await request('/auth/v1/verify',{method:'POST',body:{type:'email',email,token:String(token).replace(/\s+/g,'')},anonymous:true});return keep(value);}
  async function signOut(){try{if(session)await request('/auth/v1/logout',{method:'POST'});}finally{keep(null);}}
  async function restore(){if(!session)return null;try{const user=await request('/auth/v1/user');session.user=user;localStorage.setItem(key,JSON.stringify(session));return user;}catch(e){if(!e.offline)keep(null);throw e;}}
  async function consumeCallback(){
    const hash=new URLSearchParams(location.hash.slice(1));
    if(!hash.has('access_token'))return false;
    const value={access_token:hash.get('access_token'),refresh_token:hash.get('refresh_token'),expires_in:Number(hash.get('expires_in')||3600)};
    const recovery=hash.get('type')==='recovery';history.replaceState(null,'',location.pathname+location.search);keep(value);await restore();return recovery;
  }
  window.LumoCloud={request,sendLink,verifyCode,rpc:(name,body)=>request('/rest/v1/rpc/'+name,{method:'POST',body}),session:()=>session,signIn,signUp,signOut,restore,consumeCallback,
    recover:email=>request('/auth/v1/recover?redirect_to='+encodeURIComponent(cfg.siteUrl),{method:'POST',body:{email},anonymous:true}),
    resetPassword:password=>request('/auth/v1/user',{method:'PUT',body:{password}}),
    listClubs:()=>request('/rest/v1/lumo_clubs?select=id,name,revision,updated_at&order=name'),
    api:cfg.supabaseUrl,publicKey:cfg.publishableKey};
})();
