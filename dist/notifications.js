/* Lumo: server-backed inbox and voluntary Web Push subscription. */
(() => {
  'use strict';
  let ctx = null, rows = [], prefs = {push_enabled:false,reminders_enabled:true}, publicConfig = {}, subscribed = false, message = '', pending = false, timer = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const supported = () => isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  const emit = () => ctx?.onChanged?.({unread:rows.filter(row=>!row.read_at).length,notifications:rows,preferences:prefs});
  async function init(options) {
    const identity = options?.clubId + ':' + options?.userId;
    if(identity === ctx?.identity){ctx={...options,identity};return;}
    clearInterval(timer);ctx={...options,identity};rows=[];message='';publicConfig={};subscribed=false;
    if(!ctx.clubId || !ctx.userId)return;
    await refresh();
    timer=setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},45000);
  }
  async function refresh() {
    if(!ctx?.clubId || !ctx?.userId)return;
    const client=ctx, id=encodeURIComponent(client.clubId), user=encodeURIComponent(client.userId);
    const result=await Promise.all([
      client.api(`lumo_notifications?club_id=eq.${id}&user_id=eq.${user}&order=created_at.desc&limit=100`),
      client.api(`lumo_notification_preferences?club_id=eq.${id}&user_id=eq.${user}`),
      client.rpc('lumo_push_public_config',{p_id:client.clubId})
    ]);
    if(ctx?.identity!==client.identity)return;
    rows=result[0]||[];prefs=result[1]?.[0]||{push_enabled:false,reminders_enabled:true};publicConfig=result[2]||{};
    if(supported()){
      const registration=await navigator.serviceWorker.getRegistration();
      subscribed=Boolean(await registration?.pushManager.getSubscription());
    }
    emit();
  }
  function requireAccount(){if(!ctx?.clubId || !ctx?.userId)throw Error('Connectez-vous au club pour activer les notifications.');}
  function keyBytes(value){const text=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(text,c=>c.charCodeAt(0));}
  async function enable(){
    requireAccount();
    if(ios()&&!installed())throw Error('Sur iPhone ou iPad, ajoutez d’abord Lumo à l’écran d’accueil, puis ouvrez cette icône.');
    if(!supported())throw Error('Ce navigateur ne permet pas les notifications sur cet appareil. Vos alertes restent disponibles dans Lumo.');
    if(!publicConfig.publicKey)throw Error('Le service de notifications se prépare. Réessayez dans une minute.');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw Error(permission==='denied'?'Notifications bloquées. Autorisez-les dans les réglages du navigateur ou du téléphone.':'Autorisation non accordée. Vous pouvez réessayer plus tard.');
    const registration=await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicConfig.publicKey)});
    await ctx.rpc('register_lumo_push',{p_id:ctx.clubId,p_subscription:subscription.toJSON()});
    await ctx.rpc('lumo_set_notification_preferences',{p_id:ctx.clubId,p_push_enabled:true,p_reminders_enabled:prefs.reminders_enabled});
    message='Cet appareil est prêt à recevoir les notifications, même lorsque Lumo est fermé.';await refresh();
  }
  async function disable(){
    requireAccount();
    const registration=await navigator.serviceWorker.getRegistration();
    const subscription=await registration?.pushManager.getSubscription();
    if(subscription){await ctx.rpc('unregister_lumo_push',{p_id:ctx.clubId,p_endpoint:subscription.endpoint});await subscription.unsubscribe();}
    subscribed=false;message='Notifications désactivées sur cet appareil. Les alertes restent dans Lumo.';await refresh();
  }
  async function test(){requireAccount();await ctx.rpc('lumo_test_notification',{p_id:ctx.clubId});message='Test ajouté dans Lumo. Si cet appareil est activé, une notification arrivera sous environ une minute.';await refresh();}
  async function markRead(id){requireAccount();await ctx.rpc('lumo_mark_notification_read',{p_notification_id:id});rows=rows.map(row=>row.id===id?{...row,read_at:new Date().toISOString()}:row);emit();}
  async function markAllRead(){for(const row of rows.filter(row=>!row.read_at))await markRead(row.id);}
  async function setReminders(value){requireAccount();await ctx.rpc('lumo_set_notification_preferences',{p_id:ctx.clubId,p_push_enabled:prefs.push_enabled,p_reminders_enabled:Boolean(value)});prefs.reminders_enabled=Boolean(value);emit();}
  async function logout(){
    const registration=await navigator.serviceWorker?.getRegistration();
    const subscription=await registration?.pushManager?.getSubscription();
    if(subscription){
      try{if(ctx?.userId)await ctx.rpc('lumo_unregister_device',{p_endpoint:subscription.endpoint});}
      finally{const removed=await subscription.unsubscribe();if(!removed&&await registration.pushManager.getSubscription())throw Error('Désactivez les notifications de cet appareil avant de changer de compte.');}
    }
    disconnect();
  }
  function render(){
    const connected=Boolean(ctx?.clubId&&ctx?.userId), unread=rows.filter(row=>!row.read_at).length;
    let hint='Les alertes du club restent ici. Activez votre téléphone si vous souhaitez aussi les recevoir hors de Lumo.';
    if(ios()&&!installed())hint='Sur iPhone/iPad : Partager → Sur l’écran d’accueil. Ouvrez ensuite Lumo depuis son icône pour activer les notifications (iOS/iPadOS 16.4 ou plus récent).';
    else if(!supported())hint='Les notifications téléphone sont indisponibles dans ce navigateur. Consultez vos alertes ici, ou utilisez un navigateur compatible.';
    else if(Notification.permission==='denied')hint='L’autorisation est bloquée : ouvrez les réglages du navigateur ou du téléphone, puis autorisez les notifications pour Lumo.';
    return `<section class="lumo-notifications"><div class="page-head"><div><p class="eyebrow">Le club vous tient au courant</p><h1>Notifications</h1><p>${unread?unread+' non lue'+(unread>1?'s':''):'Vous êtes à jour'}</p></div>${connected?'<button data-notification-action="refresh">Actualiser</button>':''}</div><div class="card"><h2>Sur mon téléphone</h2><p>${hint}</p>${connected?`<p class="status">${subscribed?'Activées sur cet appareil':'Non activées sur cet appareil'}</p><div class="actions"><button ${pending?'disabled':''} class="primary" data-notification-action="${subscribed?'disable':'enable'}">${subscribed?'Désactiver cet appareil':'Activer les notifications'}</button><button ${pending?'disabled':''} data-notification-action="test">Envoyer un test</button></div><label class="check"><input type="checkbox" data-notification-reminders ${prefs.reminders_enabled?'checked':''}><span>Me rappeler les événements la veille et deux heures avant le rendez-vous</span></label>`:'<p>Connectez-vous et rejoignez le club pour retrouver vos alertes personnelles.</p>'}<p role="status" class="muted" data-notification-feedback>${esc(message)}</p></div><div class="page-head"><h2>Dans Lumo</h2>${unread?'<button data-notification-action="read-all">Tout marquer comme lu</button>':''}</div><div class="notification-list">${rows.length?rows.map(row=>{const url=row.event_id?'#event='+encodeURIComponent(row.event_id):'#';return `<article class="card notification-item ${row.read_at?'':'is-unread'}"><div><span class="chip">${row.read_at?'Lue':'Nouvelle'}</span><h3>${esc(row.title)}</h3><p>${esc(row.body)}</p><time class="muted" datetime="${esc(row.created_at)}">${esc(new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.created_at)))}</time></div><div class="actions">${row.event_id?`<a class="button" href="${esc(url)}" data-notification-open="${esc(row.id)}">Voir l’événement</a>`:''}${!row.read_at?`<button data-notification-action="read" data-notification-id="${esc(row.id)}">Marquer comme lu</button>`:''}</div></article>`;}).join(''):'<div class="empty">Aucune alerte pour le moment. Les convocations, changements et rappels apparaîtront ici.</div>'}</div></section>`;
  }
  async function run(action){if(pending)return;pending=true;try{await action();}catch(err){message=err.message||'Action impossible. Réessayez lorsque la connexion est rétablie.';}finally{pending=false;emit();const node=document.querySelector('[data-notification-feedback]');if(node)node.textContent=message;}}
  document.addEventListener('click',event=>{const button=event.target.closest('[data-notification-action]');if(button){const action=button.dataset.notificationAction;run(()=>({refresh,enable,disable,test,'read-all':markAllRead,read:()=>markRead(button.dataset.notificationId)})[action]?.());}const link=event.target.closest('[data-notification-open]');if(link)markRead(link.dataset.notificationOpen).catch(()=>{});});
  document.addEventListener('change',event=>{if(event.target.matches('[data-notification-reminders]'))run(()=>setReminders(event.target.checked));});
  function disconnect(){clearInterval(timer);ctx=null;rows=[];publicConfig={};subscribed=false;message='';}
  window.LumoNotifications={init,refresh,render,enable,disable,test,markRead,markAllRead,setReminders,disconnect,logout,get unread(){return rows.filter(row=>!row.read_at).length;},supported};
})();
