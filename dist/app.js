/* Lumo beta. No dependencies; all demo data is fictitious. */
(() => {
  'use strict';
  const C=HandCore, $=selector=>document.querySelector(selector), E=C.esc;
  const STORAGE='handclub-beta-state-v1', SETTINGS='handclub-beta-settings-v1', AUTH='handclub-beta-auth-v1';
  let state,settings={},auth=null,revision=null,syncTimer=null,saveTimer=null,dirty=false,syncing=false,conflict=false;
  let page='events',eventId=null,tab='transport',leg='outbound',groupFilter='',coach=false,installPrompt=null,importPreview=null;
  try{settings=JSON.parse(localStorage.getItem(SETTINGS)||'{}');auth=JSON.parse(localStorage.getItem(AUTH)||'null');}catch{}
  const DEMO_BACKUP=STORAGE+'-before-full-demo';
  try{state=C.validateState(JSON.parse(localStorage.getItem(STORAGE)||'null'));}catch{state=C.seedFullDemo();}
  // Upgrade the original local sample while retaining every edit in a recoverable copy.
  if(state.clubName==='Club de hand · démo'&&!state.demoRevision&&!(auth&&settings.workspaceId)){
    try{localStorage.setItem(DEMO_BACKUP,JSON.stringify({savedAt:new Date().toISOString(),payload:state}));state=C.seedFullDemo();localStorage.setItem(STORAGE,JSON.stringify(state));}catch{}
  }
  const nameOf=id=>state.members.find(member=>member.id===id)?.name||'Participant supprimé';
  const groupOf=id=>state.groups.find(group=>group.id===id)?.name||'Groupe';
  const currentEvent=()=>state.events.find(event=>event.id===eventId);
  const formatDay=value=>value?new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Paris'}).format(new Date(value+'T12:00:00Z')):'Date à préciser';
  function say(message){$('#feedback').textContent=message;$('#feedback').classList.add('visible');clearTimeout(say.timer);say.timer=setTimeout(()=>$('#feedback').classList.remove('visible'),5000);}
  function error(message){const box=$('#form-error');if(box){box.textContent=message;box.hidden=false;}else say(message);}
  function updateSaveStatus(){const box=$('#save-state');box.textContent=conflict?'Conflit · ouvrir les réglages':auth&&settings.workspaceId?(syncing?'Synchronisation…':dirty?'Modifications locales à synchroniser':'Supabase · synchronisé'):'Mode local · sauvegardé';$('#unread').textContent=state.notifications.filter(item=>!item.read).length||'';}
  function persist(){
    C.validateState(state);
    try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{throw new Error('Sauvegarde locale impossible. Exportez vos données.');}
    dirty=Boolean(auth&&settings.workspaceId);localStorage.setItem(STORAGE+'-pending',String(dirty));updateSaveStatus();clearTimeout(saveTimer);if(dirty&&!conflict)saveTimer=setTimeout(syncSave,600);
  }
  function change(action){const previous=C.clone(state);try{action();persist();render();return true;}catch(err){state=previous;render();error(err.message);return false;}}
  function notify(title,body,event=null){state.notifications.unshift({id:C.id('notification'),title,body,eventId:event,createdAt:new Date().toISOString(),read:false});state.notifications=state.notifications.slice(0,300);if(settings.localNotifications&&Notification.permission==='granted')navigator.serviceWorker?.ready.then(registration=>registration.showNotification(title,{body,icon:'./icon-192.png',tag:C.id('local'),data:{eventId:event}})).catch(()=>{});}
  function options(items,value){return items.map(([id,label])=>`<option value="${E(id)}" ${id===value?'selected':''}>${E(label)}</option>`).join('');}
  function groupOptions(value,emptyLabel){return (emptyLabel?`<option value="">${E(emptyLabel)}</option>`:'')+options(state.groups.map(group=>[group.id,(group.parentId?'↳ '+groupOf(group.parentId)+' / ':'')+group.name]),value);}
  function groupsCheckboxes(selected=[]){return state.groups.map(group=>`<label class="check"><input type="checkbox" name="groups" value="${E(group.id)}" ${selected.includes(group.id)?'checked':''}><span>${E(group.parentId?groupOf(group.parentId)+' / ':'')}${E(group.name)}</span></label>`).join('');}
  function download(filename,data,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function modal(title,body,formType=null){const dialog=$('#editor');$('#dialog-content').innerHTML=`<div class="dialog-head"><h2>${E(title)}</h2><button type="button" data-action="close-dialog" aria-label="Fermer">✕</button></div><div class="dialog-body">${formType?`<form data-form="${E(formType)}">`:''}<p id="form-error" class="error" role="alert" hidden></p>${body}${formType?'</form>':''}</div>`;if(!dialog.open)dialog.showModal();}
  function closeModal(){$('#editor').close();importPreview=null;}
  const formActions=(label='Enregistrer')=>`<div class="actions"><button class="primary" type="submit">${E(label)}</button><button type="button" data-action="close-dialog">Annuler</button></div>`;
  function render(){
    document.querySelectorAll('[data-page]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.page===page&&!eventId)));
    updateSaveStatus();
    if(eventId){if(!currentEvent()){eventId=null;render();return;}renderEvent();return;}
    ({events:renderEvents,groups:renderGroups,family:renderMembers,notifications:renderNotifications}[page]||renderEvents)();
  }
  function renderEvents(){
    const events=state.events.filter(event=>!groupFilter||event.groups.includes(groupFilter)||C.groupMembers(state,[groupFilter]).some(member=>event.attendees.some(item=>item.memberId===member.id))).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    $('#app').innerHTML=`<div class="page-head"><div><p class="eyebrow">Les rendez-vous du club</p><h1>Événements</h1><span class="muted">${E(state.clubName)}</span></div><div class="actions"><button data-action="import-calendar">Importer les matchs</button><button class="primary" data-action="new-event">Créer un événement</button></div></div><label style="max-width:360px"><span>Filtrer par groupe</span><select id="group-filter">${groupOptions(groupFilter,'Tous les groupes')}</select></label><div class="grid">${events.length?events.map(event=>{
      const out=C.transportSummary(state,event,'outbound'),back=C.transportSummary(state,event,'return');
      return `<article class="card event-card"><div class="event-heading"><h2>${E(event.title)}</h2><span class="date-ticket">${E(event.date.slice(8))}<small>${E(new Intl.DateTimeFormat('fr-FR',{month:'short',timeZone:'Europe/Paris'}).format(new Date(event.date+'T12:00:00Z')))}</small></span></div><p class="muted">${E(formatDay(event.date))} · ${E(event.time||'Horaire à préciser')}</p><p>${event.groups.map(group=>`<span class="chip">${E(groupOf(group))}</span>`).join('')}${event.cancelled?'<span class="status">Annulé</span>':''}</p><p>${E(event.address||'Adresse à préciser')}</p>${event.demoScenario?`<p class="muted">Exemple : ${E(event.demoScenario)}</p>`:''}<p class="event-balance">Aller : ${transportCount(out)} avec transport<br>Retour : ${transportCount(back)} avec transport</p><button data-action="open-event" data-id="${E(event.id)}">Ouvrir</button></article>`;
    }).join(''):'<p class="empty">Aucun événement. Créez-en un ou importez un calendrier.</p>'}</div>`;
  }
  function renderGroups(){
    $('#app').innerHTML=`<div class="page-head"><h1>Groupes et sous-groupes</h1><button class="primary" data-action="new-group">Créer un groupe</button></div><div class="grid">${state.groups.map(group=>`<article class="card"><h2>${E(group.name)}</h2><p class="muted">${group.parentId?'Sous-groupe de '+E(groupOf(group.parentId)):'Groupe principal'}</p><p>${C.groupMembers(state,[group.id]).length} participant(s)</p><div class="actions"><button data-action="view-group" data-id="${E(group.id)}">Voir les événements</button><button data-action="invite-group" data-id="${E(group.id)}">Lien du groupe</button><button data-action="edit-group" data-id="${E(group.id)}">Modifier</button></div></article>`).join('')}</div>`;
  }
  function renderMembers(){
    $('#app').innerHTML=`<div class="page-head"><h1>Participants et familles</h1><button class="primary" data-action="new-member">Ajouter un participant</button></div><p class="muted">Enfants et adultes peuvent participer avec ou sans véhicule.</p><div class="card">${state.members.map(member=>`<div class="member-line"><div><strong>${E(member.name)}</strong> <span class="chip">${member.kind==='child'?'Enfant':'Adulte'}</span><br><small>${E(member.parentName||'Lien familial à préciser')}</small><p>${member.groups.map(group=>`<span class="chip">${E(groupOf(group))}</span>`).join('')}</p></div><button data-action="edit-member" data-id="${E(member.id)}">Modifier</button></div>`).join('')||'<p>Aucun participant.</p>'}</div>`;
  }
  function renderNotifications(){
    $('#app').innerHTML=`<div class="page-head"><h1>Notifications</h1><div class="actions"><button data-action="enable-notifications">Activer les notifications de test</button><button data-action="test-notification">Tester</button><button data-action="read-notifications">Tout marquer comme lu</button></div></div><p class="notice">Ce journal fonctionne dans la bêta. Les notifications système sont des tests déclenchés depuis l’application ouverte. Le push à distance nécessite un serveur d’envoi configuré.</p><div class="card">${state.notifications.map(item=>`<article class="notification ${item.read?'':'unread'}"><strong>${E(item.title)}</strong><p>${E(item.body)}</p><small>${E(new Date(item.createdAt).toLocaleString('fr-FR'))}</small> ${item.eventId?`<button data-action="open-notification" data-id="${E(item.id)}">Voir l’événement</button>`:''}</article>`).join('')||'<p>Aucune notification. Publiez une convocation ou lancez un test.</p>'}</div>`;
  }
  function transportCount(s){return s.children?`${s.confirmed}/${s.children} enfants`:`${s.confirmedPeople}/${s.people} participants`;}
  function summaryBlock(event,journey){const s=C.transportSummary(state,event,journey),label=journey==='outbound'?'Aller':'Retour',complete=s.people>0&&s.confirmedPeople===s.people;return `<div class="${complete?'success':'warning'}"><strong>${label} · ${transportCount(s)}</strong><span>avec transport confirmé</span><p>${s.free} place(s) libre(s) · ${s.need} personne(s) cherchent<br>${s.unknown} transport(s) à renseigner</p></div>`;}
  function renderEvent(){
    const event=currentEvent();
    $('#app').innerHTML=`<button data-action="back">← Événements</button><div class="page-head" style="margin-top:16px"><h1>${E(event.title)}</h1><div class="actions"><label class="check"><input type="checkbox" id="coach-mode" ${coach?'checked':''}><span>Mode coach</span></label><button data-action="edit-event">Modifier</button><button data-action="share-event">Lien</button></div></div>${event.cancelled?'<p class="error">Cet événement est annulé.</p>':''}<div class="event-info"><div><strong>Date</strong>${E(formatDay(event.date))}</div><div><strong>Match / activité</strong>${E(event.time||'À préciser')}</div><div><strong>Rendez-vous</strong>${E(event.meetingTime||'À préciser')}<br>${E(event.meetingAddress)}</div><div><strong>Destination</strong>${E(event.address||'À préciser')}${event.address?`<br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}" target="_blank" rel="noopener noreferrer">Itinéraire</a>`:''}</div></div><p>${event.groups.map(group=>`<span class="chip">${E(groupOf(group))}</span>`).join('')}</p>${event.demoScenario?`<p class="notice"><strong>Cas de démonstration :</strong> ${E(event.demoScenario)}</p>`:''}${event.notes?`<p>${E(event.notes)}</p>`:''}${event.source?`<p class="muted">Importé du calendrier · ${E(new Date(event.source.syncedAt).toLocaleString('fr-FR'))}. Réimportez le fichier pour actualiser.</p>`:''}<div class="summary">${summaryBlock(event,'outbound')}${summaryBlock(event,'return')}</div><div class="tabs" role="group" aria-label="Rubrique de l’événement"><button data-tab="transport" aria-pressed="${tab==='transport'}">Covoiturage</button><button data-tab="organization" aria-pressed="${tab==='organization'}">Organisation</button><button data-tab="lineup" aria-pressed="${tab==='lineup'}">Disponibilités / équipes</button></div><section id="event-panel">${tab==='transport'?transportPanel(event):tab==='organization'?organizationPanel(event):lineupPanel(event)}</section>`;
  }
  function carAppearance(offer){return {skin:['classic','rallye','night'].includes(offer.appearance?.skin)?offer.appearance.skin:'classic',paint:/^#[a-f0-9]{6}$/i.test(offer.appearance?.paint||'')?offer.appearance.paint:'#007F87'};}
  function skinEditor(offer){const appearance=carAppearance(offer);return `<details class="skin-editor" data-offer-id="${E(offer.id)}"><summary>Personnaliser la voiture</summary><div class="row"><label><span>Skin</span><select data-appearance="skin" data-id="${E(offer.id)}" aria-label="Skin de ${E(offer.driver)}">${options([['classic','Essentiel'],['rallye','Rallye'],['night','Nuit électrique']],appearance.skin)}</select></label><label><span>Peinture</span><input type="color" data-appearance="paint" data-id="${E(offer.id)}" aria-label="Peinture de ${E(offer.driver)}" value="${E(appearance.paint)}"></label></div></details>`;}
  function carSeats(offer,journey){
    const appearance=carAppearance(offer),info=offer.legs[journey],slots=[{name:'Conducteur',icon:'◉',style:''}];
    slots.push(...offer.onboard.map(member=>({name:nameOf(member).split(' ')[0],icon:'✓',style:'taken'})));
    for(let count=0;count<info.reserved;count++)slots.push({name:'Prise',icon:'✓',style:'taken'});
    for(let count=0;count<info.offered-info.reserved;count++)slots.push({name:'Libre',icon:'+',style:'free'});
    while(slots.length<offer.totalSeats)slots.push({name:'Non proposée',icon:'—',style:'unavailable'});
    return `<div class="car" data-skin="${E(appearance.skin)}" style="--paint:${E(appearance.paint)}" role="img" aria-label="${E(offer.driver)}, ${info.offered-info.reserved} places libres, ${offer.onboard.length+info.reserved} passagers prévus"><div class="windscreen"></div><div class="seats">${slots.map(slot=>`<div class="seat ${slot.style}"><strong>${slot.icon}</strong>${E(slot.name)}</div>`).join('')}</div></div>`;
  }
  function transportPanel(event){
    const offers=event.offers.filter(offer=>offer.legs[leg].enabled);
    return `<div class="page-head"><div class="actions"><button data-leg="outbound" aria-pressed="${leg==='outbound'}">Aller</button><button data-leg="return" aria-pressed="${leg==='return'}">Retour</button></div><div class="actions"><button data-action="add-event-person">Ajouter un participant</button><button class="primary" data-action="new-offer" ${event.cancelled?'disabled':''}>Je propose une voiture</button></div></div><div class="car-layout">${offers.map(offer=>`<article class="car-card"><h3>${E(offer.driver)}</h3><small>${E(offer.parentOf?'Parent de '+offer.parentOf:'Lien familial à préciser')}</small>${carSeats(offer,leg)}<p class="capacity"><strong>${offer.legs[leg].offered-offer.legs[leg].reserved} place(s) libre(s)</strong><br>${offer.onboard.length} passager(s) déjà prévu(s) · ${offer.legs[leg].reserved} place(s) supplémentaire(s) prise(s)</p><div class="actions"><button data-action="edit-offer" data-id="${E(offer.id)}">Modifier les places</button><button class="danger" data-action="remove-offer" data-id="${E(offer.id)}">Retirer</button></div>${skinEditor(offer)}</article>`).join('')||'<p class="empty">Aucune voiture proposée pour ce trajet.</p>'}</div><p class="muted">Le dessin indique la capacité, pas l’emplacement réel des passagers. Une place proposée ne confirme pas à elle seule le transport d’un enfant.</p><h2 style="margin-top:22px">Transport des participants</h2><div class="card table-wrap transport-table"><table><thead><tr><th>Participant</th><th>Aller</th><th>Retour</th></tr></thead><tbody>${C.activeAttendees(event).map(attendee=>`<tr><td><strong>${E(nameOf(attendee.memberId))}</strong><br><small>${E(state.members.find(member=>member.id===attendee.memberId)?.parentName)}</small></td>${['outbound','return'].map(journey=>{
      const fixed=event.offers.some(offer=>offer.legs[journey].enabled&&offer.onboard.includes(attendee.memberId));
      return `<td><select aria-label="${journey==='outbound'?'Aller':'Retour'} de ${E(nameOf(attendee.memberId))}" data-transport="${journey}" data-member="${E(attendee.memberId)}" ${fixed?'disabled':''}>${options(Object.entries(C.transportLabels),attendee.transport[journey])}</select>${fixed?'<small>Déjà présent dans une voiture</small>':''}</td>`;
    }).join('')}</tr>`).join('')||'<tr><td colspan="3">Aucun participant sélectionné.</td></tr>'}</tbody></table></div>`;
  }
  function organizationPanel(event){return `<div class="page-head"><h2>Missions et bénévoles</h2>${coach?'<button data-action="new-mission">Ajouter une mission</button>':''}</div><div class="card">${event.missions.map(mission=>`<div class="mission"><div class="page-head"><div><strong>${E(mission.name)}</strong> <span class="status ${mission.assigned.length>=mission.needed?'ok':''}">${mission.assigned.length}/${mission.needed}</span><p>${mission.assigned.map(name=>`<span class="chip">${E(name)}</span>`).join('')||'<small>Personne inscrit pour le moment</small>'}</p></div><div class="actions"><button data-action="volunteer" data-id="${E(mission.id)}" ${mission.assigned.length>=mission.needed?'disabled':''}>Je me propose</button>${coach?`<button data-action="edit-mission" data-id="${E(mission.id)}">Gérer</button>`:''}</div></div></div>`).join('')||'<p>Aucune mission. Activez le mode coach pour en ajouter.</p>'}</div>`;}
  function lineupPanel(event){return `<div class="page-head"><div><h2>Disponibilités et équipes</h2><span class="muted">${event.rosterPublished?'Convocation publiée':'Convocation non publiée'}</span></div><div class="actions"><button data-action="export-csv">Exporter Excel (.csv)</button>${coach?'<button class="primary" data-action="publish-lineup">Publier la convocation</button>':''}</div></div>${!coach?'<p class="muted">Activez le mode coach pour choisir les joueurs et les équipes.</p>':''}<div class="card table-wrap"><table><thead><tr><th>Participant</th><th>Disponibilité</th><th>Convoqué</th><th>Équipe</th></tr></thead><tbody>${event.attendees.map(attendee=>`<tr><td>${E(nameOf(attendee.memberId))}</td><td><select data-availability data-member="${E(attendee.memberId)}" aria-label="Disponibilité de ${E(nameOf(attendee.memberId))}">${options([['unknown','À renseigner'],['present','Disponible'],['absent','Absent']],attendee.availability)}</select></td><td><input type="checkbox" data-selected data-member="${E(attendee.memberId)}" aria-label="Convoquer ${E(nameOf(attendee.memberId))}" ${attendee.selected?'checked':''} ${coach?'':'disabled'}></td><td>${coach?`<input data-team data-member="${E(attendee.memberId)}" aria-label="Équipe de ${E(nameOf(attendee.memberId))}" maxlength="80" value="${E(attendee.team)}">`:E(attendee.team||'—')}</td></tr>`).join('')}</tbody></table></div>`;}
  function groupDialog(group=null){modal(group?'Modifier le groupe':'Créer un groupe',`<input type="hidden" name="id" value="${E(group?.id||'')}"><label><span>Nom</span><input name="name" required maxlength="100" value="${E(group?.name||'')}" placeholder="−13 filles, secteur Gervanne…"></label><label><span>Groupe parent (facultatif)</span><select name="parentId">${groupOptions(group?.parentId||'','Groupe principal')}</select></label>${formActions()}`,'group');}
  function memberDialog(member=null){modal(member?'Modifier le participant':'Ajouter un participant',`<input type="hidden" name="id" value="${E(member?.id||'')}"><label><span>Nom et prénom</span><input name="name" required maxlength="100" value="${E(member?.name||'')}"></label><label><span>Type</span><select name="kind">${options([['child','Enfant'],['adult','Adulte']],member?.kind||'child')}</select></label><label><span>Parent(s) ou lien familial</span><input name="parentName" maxlength="150" value="${E(member?.parentName||'')}"></label><fieldset><legend>Groupes</legend>${groupsCheckboxes(member?.groups||[])}</fieldset>${formActions()}`,'member');}
  function eventDialog(event=null){modal(event?'Modifier l’événement':'Créer un événement',`<input type="hidden" name="id" value="${E(event?.id||'')}"><label><span>Titre</span><input name="title" required maxlength="150" value="${E(event?.title||'')}"></label><div class="form-grid"><label><span>Type</span><select name="type">${options([['match','Match'],['training','Entraînement'],['special','Soirée / événement']],event?.type||'match')}</select></label><label><span>Date</span><input type="date" name="date" required value="${E(event?.date||C.dayString(new Date()))}"></label><label><span>Heure du match / activité</span><input type="time" name="time" value="${E(event?.time||'')}"></label><label><span>Heure du rendez-vous</span><input type="time" name="meetingTime" value="${E(event?.meetingTime||'')}"></label></div><label><span>Lieu du rendez-vous</span><input name="meetingAddress" maxlength="250" value="${E(event?.meetingAddress||'')}"></label><label><span>Adresse du match / gymnase</span><input name="address" maxlength="300" value="${E(event?.address||'')}"></label><fieldset><legend>Groupes concernés (plusieurs possibles)</legend>${groupsCheckboxes(event?.groups||(groupFilter?[groupFilter]:[]))}</fieldset>${!event?'<label><span>Répéter chaque semaine</span><select name="repeat">'+options([['1','Une seule date'],['4','4 dates'],['8','8 dates'],['12','12 dates']],'1')+'</select></label>':''}<label><span>Notes</span><textarea name="notes" maxlength="1500">${E(event?.notes||'')}</textarea></label>${event?`<label class="check"><input type="checkbox" name="cancelled" ${event.cancelled?'checked':''}><span>Événement annulé</span></label>`:''}${formActions()}`,'event');}
  function offerDialog(offer=null){const event=currentEvent();modal(offer?'Modifier la voiture':'Je propose une voiture',`<input type="hidden" name="id" value="${E(offer?.id||'')}"><label><span>Nom du conducteur</span><input name="driver" required maxlength="100" value="${E(offer?.driver||'')}"></label><label><span>Parent de qui ?</span><input name="parentOf" maxlength="150" value="${E(offer?.parentOf||'')}"></label><label><span>Places dans le véhicule, conducteur compris</span><input type="number" name="totalSeats" min="2" max="9" required value="${offer?.totalSeats||5}"></label><fieldset><legend>Passagers déjà présents (hors conducteur)</legend>${event.attendees.map(attendee=>`<label class="check"><input type="checkbox" name="onboard" value="${E(attendee.memberId)}" ${offer?.onboard.includes(attendee.memberId)?'checked':''}><span>${E(nameOf(attendee.memberId))}</span></label>`).join('')}</fieldset><p class="muted">Les places supplémentaires ci-dessous excluent les passagers déjà cochés.</p><div class="form-grid">${['outbound','return'].map(journey=>`<fieldset><legend>${journey==='outbound'?'Aller':'Retour'}</legend><label class="check"><input name="${journey}Enabled" type="checkbox" ${offer?offer.legs[journey].enabled?'checked':'':'checked'}><span>Je conduis pour ce trajet</span></label><label><span>Places supplémentaires proposées</span><input name="${journey}Offered" type="number" required min="0" max="8" value="${offer?.legs[journey].offered??0}"></label><label><span>Dont places déjà prises</span><input name="${journey}Reserved" type="number" required min="0" max="8" value="${offer?.legs[journey].reserved??0}"></label></fieldset>`).join('')}</div>${formActions()}`,'offer');}
  function missionDialog(mission=null){modal(mission?'Gérer la mission':'Ajouter une mission',`<input type="hidden" name="id" value="${E(mission?.id||'')}"><label><span>Mission</span><input name="name" required maxlength="100" placeholder="Arbitre, maillots, buvette…" value="${E(mission?.name||'')}"></label><label><span>Personnes recherchées</span><input name="needed" type="number" min="1" max="50" required value="${mission?.needed||1}"></label><label><span>Personnes affectées (une par ligne)</span><textarea name="assigned">${E(mission?.assigned.join('\n')||'')}</textarea></label>${formActions()}`,'mission');}
  function importDialog(){modal('Importer un calendrier FFHandball',`<p>Sur FFHandball : « Ajouter les matchs à votre calendrier » → sélectionner une équipe → iCal (.ics).</p><p><a href="https://www.ffhandball.fr/competitions/saison-2026-2027-22/regional/m18-ans-masculin-division-1-aura-30511/poule-196963/" target="_blank" rel="noopener noreferrer">Ouvrir la page exemple</a></p><label><span>Groupe destinataire</span><select name="groupId" required>${groupOptions(groupFilter||state.groups[0]?.id)}</select></label><label><span>Filtrer le nom d’une équipe (facultatif)</span><input name="filter" maxlength="150" placeholder="Ex. HBC CHABEUIL 18M"></label><label><span>Fichier calendrier .ics</span><input type="file" name="file" accept=".ics,text/calendar"></label><p class="muted">Ou essayez l’import par URL. Si le site bloque la lecture depuis le navigateur, utilisez le fichier.</p><label><span>URL du fichier .ics</span><input type="url" name="url" placeholder="https://competition-calendar.ffhandball.fr/…"></label><p class="muted">La bêta importe à la demande. Elle ne synchronise pas les matchs en arrière-plan. Une réimportation préserve les voitures, réponses et missions.</p>${formActions('Prévisualiser')}`,'import-preview');}
  function settingsDialog(){modal('Réglages de la bêta',`<section><h3>Données locales</h3><div class="actions"><button data-action="export-json">Exporter la sauvegarde</button><button data-action="restore-json">Restaurer une sauvegarde</button><button data-action="load-full-demo">Charger la démo complète</button>${localStorage.getItem(DEMO_BACKUP)?'<button data-action="restore-before-demo">Restaurer les données avant la démo</button>':''}</div><p class="muted">Charger la démo conserve une copie locale de vos données précédentes.</p><label><span>Nom du club</span><input id="club-name" value="${E(state.clubName)}" maxlength="100"></label><button data-action="save-club-name">Enregistrer le nom</button></section><hr><section><h3>Supabase · optionnel</h3><p class="muted">Exécutez supabase.sql dans votre projet puis renseignez l’URL et la clé publique. Tous les membres de l’espace peuvent modifier les données de cette bêta.</p><label><span>URL du projet</span><input id="sb-url" type="url" value="${E(settings.supabaseUrl||'')}" placeholder="https://votre-projet.supabase.co"></label><label><span>Clé publique publishable / anon (jamais service_role)</span><input id="sb-key" value="${E(settings.supabaseKey||'')}" autocomplete="off"></label><button data-action="save-supabase-config">Enregistrer la configuration</button>${auth?`<p>Compte connecté : ${E(auth.email)}</p><p>Révision de l’espace : ${revision??'non chargé'}</p><div class="actions"><button data-action="create-workspace">Créer un espace avec ces données</button><button data-action="join-workspace">Rejoindre avec un code</button><button data-action="show-invite-code">Code de l’espace</button><button data-action="reload-cloud">Recharger depuis Supabase</button><button data-action="sync-now">Synchroniser</button><button data-action="signout">Déconnexion</button></div>${conflict?'<p class="error">Une autre personne a modifié les données. Exportez vos modifications locales puis rechargez la version Supabase avant de les refaire.</p>':''}`:`<label><span>Email du compte Supabase Auth</span><input id="sb-email" type="email" autocomplete="username"></label><label><span>Mot de passe</span><input id="sb-password" type="password" autocomplete="current-password"></label><button data-action="signin">Se connecter</button><p class="muted">Créez les comptes dans Supabase Auth pour ce test. La bêta ne crée pas de compte automatiquement.</p>`}</section><hr><section><h3>Notifications</h3><p class="muted">Les tests de notifications sont disponibles dans l’onglet Notifications. Pour recevoir du push quand l’app est fermée, configurez une fonction serveur d’envoi.</p><label><span>Clé publique VAPID du serveur (facultatif)</span><input id="vapid-key" value="${E(settings.vapidKey||'')}"></label><button data-action="subscribe-push">Enregistrer cet appareil pour le push</button></section>`);}
  function setOnboardStatuses(event,oldOffer,newOffer){
    for(const journey of ['outbound','return']){
      for(const member of oldOffer?.onboard||[])if(oldOffer.legs[journey].enabled&&(!newOffer?.legs[journey].enabled||!newOffer.onboard.includes(member))&&!event.offers.some(offer=>offer.id!==oldOffer.id&&offer.legs[journey].enabled&&offer.onboard.includes(member))){const attendee=event.attendees.find(item=>item.memberId===member);if(attendee)attendee.transport[journey]='unknown';}
      if(newOffer?.legs[journey].enabled)for(const member of newOffer.onboard){const attendee=event.attendees.find(item=>item.memberId===member);if(attendee){if(attendee.availability==='absent'||!attendee.selected)throw new Error(nameOf(member)+' est absent ou non convoqué.');const person=state.members.find(item=>item.id===member);attendee.transport[journey]=person?.kind==='child'&&person.parentName.toLocaleLowerCase('fr').includes(newOffer.driver.toLocaleLowerCase('fr'))?'parent':'confirmed';}}
    }
  }
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();const data=new FormData(form),type=form.dataset.form;
    try{
      if(type==='import-preview'){
        const file=data.get('file');let text;
        if(file?.size){if(file.size>2000000)throw new Error('Fichier trop volumineux.');text=await file.text();}else if(data.get('url')){
          const url=new URL(data.get('url'));if(url.protocol!=='https:')throw new Error('Utilisez une URL HTTPS.');
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
          try{const response=await fetch(url.href,{signal:controller.signal,credentials:'omit'});if(!response.ok)throw new Error();text=await response.text();}catch{throw new Error('Impossible de lire ce lien depuis le navigateur. Téléchargez le fichier .ics sur FFHandball puis importez-le.');}finally{clearTimeout(timer);}
        }else throw new Error('Choisissez un fichier .ics ou une URL.');
        const parsed=C.parseIcs(text),groupId=data.get('groupId'),filter=data.get('filter').trim(),records=parsed.records.filter(record=>!filter||record.title.toLocaleLowerCase('fr').includes(filter.toLocaleLowerCase('fr')));
        if(!records.length)throw new Error('Aucun match ne correspond à ce filtre.');importPreview={records,groupId};
        modal('Vérifier les matchs à importer',`<p>${records.length} rencontre(s) pour ${E(groupOf(groupId))}.${parsed.invalid?' '+parsed.invalid+' entrée(s) ignorée(s) car incomplète(s).':''}</p><div class="table-wrap"><table><thead><tr><th>Date</th><th>Match</th><th>Lieu</th></tr></thead><tbody>${records.map(record=>`<tr><td>${E(record.date)} ${E(record.time||'À préciser')}</td><td>${E(record.title)}</td><td>${E(record.address)}</td></tr>`).join('')}</tbody></table></div><p class="muted">Les matchs absents du fichier restent dans l’application.</p><button class="primary" data-action="confirm-import">Importer ces matchs</button>`);return;
      }
      if(type==='group'){
        const item={id:data.get('id')||C.id('group'),name:data.get('name').trim(),parentId:data.get('parentId')||null};if(!item.name)throw new Error('Indiquez le nom du groupe.');
        if(change(()=>{const old=state.groups.find(group=>group.id===item.id);old?Object.assign(old,item):state.groups.push(item);}))closeModal();return;
      }
      if(type==='member'){
        const item={id:data.get('id')||C.id('member'),name:data.get('name').trim(),kind:data.get('kind'),parentName:data.get('parentName').trim(),groups:data.getAll('groups')};
        if(!item.name||!item.groups.length)throw new Error('Indiquez un nom et au moins un groupe.');
        if(change(()=>{const old=state.members.find(member=>member.id===item.id);old?Object.assign(old,item):state.members.push(item);for(const activity of state.events)if(C.groupMembers(state,activity.groups).some(member=>member.id===item.id)&&!activity.attendees.some(attendee=>attendee.memberId===item.id))activity.attendees.push(C.newAttendee(item.id));}))closeModal();return;
      }
      if(type==='event'){
        const groups=data.getAll('groups');if(!groups.length)throw new Error('Choisissez au moins un groupe.');
        const values={title:data.get('title').trim(),type:data.get('type'),date:data.get('date'),time:data.get('time'),meetingTime:data.get('meetingTime'),meetingAddress:data.get('meetingAddress').trim(),address:data.get('address').trim(),notes:data.get('notes').trim(),groups,cancelled:data.has('cancelled')};
        if(!values.title)throw new Error('Indiquez un titre.');
        if(change(()=>{
          const old=state.events.find(activity=>activity.id===data.get('id'));
          if(old){const changedTime=old.date!==values.date||old.time!==values.time||old.address!==values.address||old.meetingTime!==values.meetingTime||old.cancelled!==values.cancelled;Object.assign(old,values);for(const member of C.groupMembers(state,groups))if(!old.attendees.some(attendee=>attendee.memberId===member.id))old.attendees.push(C.newAttendee(member.id));if(changedTime)notify('Informations modifiées',old.title+' : consultez les horaires et le lieu.',old.id);}
          else{const count=Number(data.get('repeat')||1),seriesId=count>1?C.id('series'):null;for(let index=0;index<count;index++){const day=new Date(values.date+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+7*index);const activity={...C.clone(values),date:day.toISOString().slice(0,10),id:C.id('event'),seriesId,source:null,rosterPublished:false,attendees:C.groupMembers(state,groups).map(member=>C.newAttendee(member.id)),offers:[],missions:[]};state.events.push(activity);if(index===0)eventId=activity.id;}}
        }))closeModal();return;
      }
      if(type==='offer'){
        const activity=currentEvent(),offer={id:data.get('id')||C.id('car'),driver:data.get('driver').trim(),parentOf:data.get('parentOf').trim(),totalSeats:Number(data.get('totalSeats')),onboard:data.getAll('onboard'),legs:{}};
        for(const journey of ['outbound','return'])offer.legs[journey]={enabled:data.has(journey+'Enabled'),offered:data.has(journey+'Enabled')?Number(data.get(journey+'Offered')):0,reserved:data.has(journey+'Enabled')?Number(data.get(journey+'Reserved')):0};
        if(!offer.legs.outbound.enabled&&!offer.legs.return.enabled)throw new Error('Choisissez au moins un trajet.');C.checkOffer(offer);
        if(change(()=>{const old=activity.offers.find(item=>item.id===offer.id);setOnboardStatuses(activity,old,offer);old?Object.assign(old,offer):activity.offers.push(offer);}))closeModal();return;
      }
      if(type==='mission'){
        if(!coach)throw new Error('Activez le mode coach.');const activity=currentEvent(),mission={id:data.get('id')||C.id('mission'),name:data.get('name').trim(),needed:Number(data.get('needed')),assigned:[...new Set(data.get('assigned').split('\n').map(name=>name.trim()).filter(Boolean))]};
        if(!mission.name)throw new Error('Indiquez la mission.');if(change(()=>{const old=activity.missions.find(item=>item.id===mission.id);old?Object.assign(old,mission):activity.missions.push(mission);}))closeModal();return;
      }
      if(type==='volunteer'){
        const mission=currentEvent().missions.find(item=>item.id===data.get('id')),name=data.get('name').trim();if(!name)throw new Error('Indiquez votre nom.');
        if(change(()=>{if(mission.assigned.includes(name))throw new Error('Cette personne est déjà inscrite.');if(mission.assigned.length>=mission.needed)throw new Error('La mission est déjà remplie.');mission.assigned.push(name);notify('Bénévole inscrit',name+' : '+mission.name,currentEvent().id);}))closeModal();return;
      }
      if(type==='add-event-person'){
        const activity=currentEvent(),memberId=data.get('memberId');if(change(()=>{if(activity.attendees.some(item=>item.memberId===memberId))throw new Error('Ce participant est déjà dans la liste.');activity.attendees.push(C.newAttendee(memberId));}))closeModal();return;
      }
    }catch(err){error(err.message);}
  });
  document.addEventListener('change',event=>{
    const control=event.target;
    if(control.dataset.appearance){const property=control.dataset.appearance,value=control.value,offerId=control.dataset.id;if(property==='skin'&&!['classic','rallye','night'].includes(value))return;if(property==='paint'&&!/^#[a-f0-9]{6}$/i.test(value))return;change(()=>{const offer=currentEvent()?.offers.find(item=>item.id===offerId);if(!offer)throw new Error('Voiture introuvable.');offer.appearance={...carAppearance(offer),[property]:value};});for(const editor of document.querySelectorAll('.skin-editor'))if(editor.dataset.offerId===offerId)editor.open=true;return;}
    if(control.id==='group-filter'){groupFilter=control.value;render();return;}
    if(control.id==='coach-mode'){coach=control.checked;render();return;}
    if(control.dataset.transport){change(()=>{const attendee=currentEvent().attendees.find(item=>item.memberId===control.dataset.member);attendee.transport[control.dataset.transport]=control.value;});return;}
    if(control.hasAttribute('data-availability')){change(()=>{
      const activity=currentEvent();if(control.value==='absent'&&activity.offers.some(offer=>offer.onboard.includes(control.dataset.member)))throw new Error('Retirez d’abord ce participant de la voiture où il est déjà présent.');
      activity.attendees.find(item=>item.memberId===control.dataset.member).availability=control.value;
    });return;}
    if(control.hasAttribute('data-selected')){if(!coach)return;change(()=>{const activity=currentEvent();if(!control.checked&&activity.offers.some(offer=>offer.onboard.includes(control.dataset.member)))throw new Error('Retirez d’abord ce participant de sa voiture.');activity.attendees.find(item=>item.memberId===control.dataset.member).selected=control.checked;activity.rosterPublished=false;});return;}
    if(control.hasAttribute('data-team')){if(coach)change(()=>{currentEvent().attendees.find(item=>item.memberId===control.dataset.member).team=control.value.trim();currentEvent().rosterPublished=false;});}
  });
  document.addEventListener('click',async event=>{
    const control=event.target.closest('button[data-action],button[data-page],button[data-tab],button[data-leg]');if(!control||control.disabled)return;
    try{
      if(control.dataset.page){page=control.dataset.page;eventId=null;location.hash='';render();return;}
      if(control.dataset.tab){tab=control.dataset.tab;render();return;}
      if(control.dataset.leg){leg=control.dataset.leg;render();return;}
      const action=control.dataset.action;
      if(action==='close-dialog'){closeModal();return;}
      if(action==='back'){eventId=null;location.hash='';render();return;}
      if(action==='open-event'){eventId=control.dataset.id;tab='transport';location.hash='event='+encodeURIComponent(eventId);render();return;}
      if(action==='new-group')groupDialog();
      if(action==='edit-group')groupDialog(state.groups.find(group=>group.id===control.dataset.id));
      if(action==='new-member')memberDialog();
      if(action==='edit-member')memberDialog(state.members.find(member=>member.id===control.dataset.id));
      if(action==='new-event')eventDialog();
      if(action==='edit-event')eventDialog(currentEvent());
      if(action==='new-offer')offerDialog();
      if(action==='edit-offer')offerDialog(currentEvent().offers.find(offer=>offer.id===control.dataset.id));
      if(action==='remove-offer'){
        const offer=currentEvent().offers.find(item=>item.id===control.dataset.id);
        modal('Retirer la voiture',`<p>Retirer la proposition de ${E(offer.driver)} ? Les transports des passagers déjà présents repasseront à « À renseigner ».</p><button class="danger" data-action="confirm-remove-offer" data-id="${E(offer.id)}">Retirer cette proposition</button>`);
      }
      if(action==='confirm-remove-offer'){if(change(()=>{const activity=currentEvent(),offer=activity.offers.find(item=>item.id===control.dataset.id);setOnboardStatuses(activity,offer,null);activity.offers=activity.offers.filter(item=>item.id!==offer.id);})){closeModal();say('Voiture retirée.');}}
      if(action==='new-mission'&&coach)missionDialog();
      if(action==='edit-mission'&&coach)missionDialog(currentEvent().missions.find(mission=>mission.id===control.dataset.id));
      if(action==='volunteer'){const mission=currentEvent().missions.find(item=>item.id===control.dataset.id);modal('Se proposer · '+mission.name,`<input name="id" type="hidden" value="${E(mission.id)}"><label><span>Votre nom</span><input name="name" required maxlength="100" list="adult-names"></label><datalist id="adult-names">${state.members.filter(member=>member.kind==='adult').map(member=>`<option value="${E(member.name)}">`).join('')}</datalist>${formActions('Je me propose')}`,'volunteer');}
      if(action==='add-event-person'){const activity=currentEvent(),available=state.members.filter(member=>!activity.attendees.some(item=>item.memberId===member.id));if(!available.length){say('Tous les participants sont déjà inscrits. Ajoutez-en depuis Participants.');return;}modal('Ajouter un participant',`<label><span>Participant</span><select name="memberId">${options(available.map(member=>[member.id,member.name]),available[0].id)}</select></label>${formActions('Ajouter')}`,'add-event-person');}
      if(action==='view-group'){groupFilter=control.dataset.id;page='events';eventId=null;render();}
      if(action==='share-event'||action==='invite-group'){
        const url=new URL(location.href);url.hash=action==='share-event'?'event='+encodeURIComponent(eventId):'group='+encodeURIComponent(control.dataset.id);
        modal('Partager un lien',`<label><span>Lien</span><input readonly value="${E(url.href)}"></label><p class="muted">En mode local, ce lien ouvre uniquement les données déjà présentes sur l’appareil du destinataire. Pour partager les mêmes données, connectez Supabase et faites rejoindre l’espace avec son code.</p><button data-action="copy-link" data-url="${E(url.href)}">Copier</button>`);
      }
      if(action==='copy-link'){try{await navigator.clipboard.writeText(control.dataset.url);say('Lien copié.');}catch{say('Sélectionnez le lien et copiez-le.');}}
      if(action==='import-calendar')importDialog();
      if(action==='confirm-import'){
        if(!importPreview)throw new Error('Relancez la prévisualisation.');const result={};
        if(change(()=>{Object.assign(result,C.importRecords(state,importPreview.records,importPreview.groupId));for(const changedId of result.changed)notify('Match actualisé',state.events.find(item=>item.id===changedId).title,changedId);})){closeModal();eventId=null;page='events';render();say(`${result.added} ajouté(s), ${result.updated} actualisé(s), ${result.unchanged} inchangé(s).`);}
      }
      if(action==='publish-lineup'&&coach){const activity=currentEvent();if(change(()=>{activity.rosterPublished=true;const people=C.activeAttendees(activity).map(item=>nameOf(item.memberId));notify('Convocation publiée',activity.title+' · '+formatDay(activity.date)+' · '+people.join(', '),activity.id);})){say('Convocation ajoutée au journal de la bêta.');}}
      if(action==='export-csv')exportCsv();
      if(action==='read-notifications')change(()=>state.notifications.forEach(item=>item.read=true));
      if(action==='open-notification'){const notification=state.notifications.find(item=>item.id===control.dataset.id);if(change(()=>notification.read=true)){eventId=notification.eventId;location.hash='event='+encodeURIComponent(eventId);render();}}
      if(action==='enable-notifications')await enableNotifications();
      if(action==='test-notification'){
        if(!settings.localNotifications)await enableNotifications();if(settings.localNotifications)change(()=>notify('Lumo · test','Les notifications de test fonctionnent sur cet appareil.',state.events[0]?.id||null));
      }
      if(action==='settings')settingsDialog();
      if(action==='export-json')download('lumo-sauvegarde.json',JSON.stringify(state,null,2));
      if(action==='restore-json'){
        if(auth&&settings.workspaceId)throw new Error('Déconnectez Supabase avant de restaurer une sauvegarde locale.');
        const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{if(!input.files[0])return;if(input.files[0].size>5000000)throw new Error('Sauvegarde trop volumineuse.');const imported=C.validateState(JSON.parse(await input.files[0].text()));download('lumo-avant-restauration.json',JSON.stringify(state,null,2));state=imported;persist();closeModal();render();say('Sauvegarde restaurée.');}catch(err){error(err.message);}};input.click();
      }
      if(action==='load-full-demo'||action==='reset-demo'){
        if(auth&&settings.workspaceId)throw new Error('Déconnectez Supabase avant de charger la démo locale.');
        modal('Charger la démo complète',`<p>11 groupes et sous-groupes, 49 participants, 12 événements et 6 notifications fictives.</p><p>Vos données actuelles seront conservées sur cet appareil. Vous pourrez les retrouver dans Réglages → Restaurer les données avant la démo.</p><button class="primary" data-action="confirm-full-demo">Charger les exemples</button>`);
      }
      if(action==='confirm-full-demo'){
        if(auth&&settings.workspaceId)throw new Error('Déconnectez Supabase avant de charger la démo locale.');
        localStorage.setItem(DEMO_BACKUP,JSON.stringify({savedAt:new Date().toISOString(),payload:state}));
        if(change(()=>{state=C.seedFullDemo();})){eventId=null;page='events';groupFilter='';location.hash='';closeModal();render();say('Démo complète chargée. Vos données précédentes sont conservées dans les réglages.');}
      }
      if(action==='restore-before-demo'){
        if(auth&&settings.workspaceId)throw new Error('Déconnectez Supabase avant de restaurer des données locales.');
        const backup=JSON.parse(localStorage.getItem(DEMO_BACKUP)||'null');if(!backup)throw new Error('Aucune sauvegarde avant la démo.');
        const restored=C.validateState(backup.payload),previous=C.clone(state);
        if(change(()=>{state=restored;})){localStorage.setItem(DEMO_BACKUP,JSON.stringify({savedAt:new Date().toISOString(),payload:previous}));eventId=null;page='events';groupFilter='';location.hash='';closeModal();render();say('Données précédentes restaurées. La copie de la démo reste disponible dans les réglages.');}
      }

      if(action==='save-club-name'){if(change(()=>{state.clubName=$('#club-name').value.trim()||'Club de hand';}))say('Nom enregistré.');}
      if(action==='save-supabase-config'){
        if(auth)throw new Error('Déconnectez-vous avant de changer de projet Supabase.');
        const url=new URL($('#sb-url').value.trim());if(url.protocol!=='https:'||url.username||url.password)throw new Error('URL Supabase HTTPS requise.');
        const key=$('#sb-key').value.trim();if(!key)throw new Error('Indiquez la clé publique.');if(key.startsWith('sb_secret_'))throw new Error('Utilisez une clé publique, jamais une clé secrète.');
        if(key.split('.').length===3){try{const payload=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role==='service_role')throw new Error('Clé service_role interdite dans le navigateur.');}catch(err){if(err.message.includes('interdite'))throw err;}}
        settings.supabaseUrl=url.origin;settings.supabaseKey=key;delete settings.workspaceId;storeSettings();say('Configuration enregistrée.');
      }
      if(action==='signin'){
        const email=$('#sb-email').value.trim(),password=$('#sb-password').value;if(!email||!password)throw new Error('Indiquez l’email et le mot de passe.');
        const response=await sb('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},unauthenticated:true});
        auth={...response,email:response.user.email,expires_at:Date.now()+response.expires_in*1000};storeAuth();settingsDialog();if(settings.workspaceId)await loadCloud(true);say('Compte connecté.');
      }
      if(action==='signout'){clearTimeout(saveTimer);clearInterval(syncTimer);auth=null;revision=null;dirty=false;conflict=false;delete settings.workspaceId;storeSettings();storeAuth();settingsDialog();updateSaveStatus();}
      if(action==='create-workspace'){
        if(settings.workspaceId)throw new Error('Vous êtes déjà dans un espace. Déconnectez-vous pour en créer un autre.');
        const workspace=await rpc('create_beta_workspace',{p_name:state.clubName,p_payload:state});settings.workspaceId=workspace.workspace_id;revision=workspace.revision;dirty=false;storeSettings();startPolling();settingsDialog();say('Espace créé. Partagez son code depuis les réglages.');
      }
      if(action==='join-workspace')modal('Rejoindre un espace Supabase',`<p>Vos données locales seront exportées avant de charger celles de l’espace.</p><label><span>Code d’invitation de l’espace</span><input id="join-code" autocomplete="off"></label><button class="primary" data-action="confirm-join">Rejoindre</button>`);
      if(action==='confirm-join'){
        const code=$('#join-code').value.trim();if(!code)throw new Error('Indiquez un code.');const joined=await rpc('join_beta_workspace',{p_code:code});download('lumo-avant-connexion.json',JSON.stringify(state,null,2));settings.workspaceId=joined.workspace_id;storeSettings();dirty=false;conflict=false;await loadCloud(true);closeModal();startPolling();say('Espace rejoint.');
      }
      if(action==='show-invite-code'){
        const result=await rpc('beta_workspace_invite',{p_id:settings.workspaceId});modal('Code de l’espace',`<label><span>Code à transmettre aux testeurs</span><input readonly value="${E(result.invite_code)}"></label><p>Les personnes qui rejoignent avec ce code peuvent lire et modifier tout cet espace de bêta.</p>`);
      }
      if(action==='reload-cloud'){
        if(dirty||conflict)download('lumo-modifications-locales.json',JSON.stringify(state,null,2));dirty=false;conflict=false;await loadCloud(true);settingsDialog();say('Version Supabase rechargée.');
      }
      if(action==='sync-now'){await syncSave();if(!dirty&&!conflict)say('Synchronisation terminée.');}
      if(action==='subscribe-push')await subscribePush();
    }catch(err){error(err.message);}
  });
  function exportCsv(){
    const activity=currentEvent();const cell=value=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
    const rows=[['Événement','Date','Heure','Participant','Disponibilité','Convoqué','Équipe','Aller','Retour'],...activity.attendees.map(attendee=>[activity.title,activity.date,activity.time,nameOf(attendee.memberId),{present:'Disponible',absent:'Absent',unknown:'À renseigner'}[attendee.availability],attendee.selected?'Oui':'Non',attendee.team,C.transportLabels[attendee.transport.outbound],C.transportLabels[attendee.transport.return]]),[],['Mission','Personnes recherchées','Personnes affectées'],...activity.missions.map(mission=>[mission.name,mission.needed,mission.assigned.join(', ')])];
    download('organisation-'+activity.date+'.csv','\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8');
  }
  async function enableNotifications(){
    if(!('Notification'in window)||!('serviceWorker'in navigator)||!window.isSecureContext)throw new Error('Les notifications nécessitent un navigateur compatible et une page HTTPS ou localhost.');
    const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notifications non autorisées. Vous pouvez les activer dans les réglages du navigateur.');
    await swReady();settings.localNotifications=true;storeSettings();say('Notifications de test activées.');
  }
  async function swReady(){if(!('serviceWorker'in navigator))throw new Error('Service worker indisponible.');return Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Service worker indisponible. Ouvrez la bêta en HTTPS ou sur localhost.')),8000))]);}
  function storeSettings(){localStorage.setItem(SETTINGS,JSON.stringify(settings));}
  function storeAuth(){auth?localStorage.setItem(AUTH,JSON.stringify(auth)):localStorage.removeItem(AUTH);}
  async function sb(path,{method='GET',body,unauthenticated=false}={}){
    if(!settings.supabaseUrl||!settings.supabaseKey)throw new Error('Configurez Supabase dans les réglages.');
    if(!unauthenticated&&auth?.expires_at<Date.now()+30000){const refreshed=await sb('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:auth.refresh_token},unauthenticated:true});auth={...refreshed,email:refreshed.user.email,expires_at:Date.now()+refreshed.expires_in*1000};storeAuth();}
    const headers={apikey:settings.supabaseKey,'Content-Type':'application/json'};
    if(!unauthenticated){if(!auth)throw new Error('Connectez votre compte Supabase.');headers.Authorization='Bearer '+auth.access_token;}
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{const response=await fetch(settings.supabaseUrl+path,{method,headers,signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload?.message||payload?.msg||payload?.error_description||'Erreur Supabase '+response.status);return payload;}finally{clearTimeout(timeout);}
  }
  const rpc=(name,body)=>sb('/rest/v1/rpc/'+name,{method:'POST',body});
  async function syncSave(){
    if(!auth||!settings.workspaceId||!dirty||syncing||conflict)return;
    if(revision===null){conflict=true;updateSaveStatus();say('Rechargez votre espace Supabase avant de synchroniser.');return;}
    syncing=true;updateSaveStatus();const snapshot=JSON.stringify(state),expected=revision;
    try{const result=await rpc('save_beta_workspace',{p_id:settings.workspaceId,p_expected_revision:expected,p_payload:JSON.parse(snapshot)});revision=result.revision;dirty=JSON.stringify(state)!==snapshot;localStorage.setItem(STORAGE+'-pending',String(dirty));if(dirty)saveTimer=setTimeout(syncSave,400);}
    catch(err){if(err.message.includes('REVISION_CONFLICT')){conflict=true;say('Une autre personne a modifié l’espace. Ouvrez les réglages pour recharger.');}else say('Sauvegarde locale conservée. Supabase : '+err.message);}
    finally{syncing=false;updateSaveStatus();}
  }
  async function loadCloud(force=false){
    if(!auth||!settings.workspaceId||syncing||((dirty||$('#editor').open)&&!force))return;
    const rows=await sb('/rest/v1/beta_workspaces?id=eq.'+encodeURIComponent(settings.workspaceId)+'&select=id,payload,revision');
    if(!force&&(dirty||$('#editor').open))return;
    if(!rows?.length)throw new Error('Espace introuvable ou accès refusé.');const row=rows[0];
    if(row.revision!==revision||force){state=C.validateState(row.payload);revision=row.revision;dirty=false;conflict=false;localStorage.setItem(STORAGE,JSON.stringify(state));localStorage.setItem(STORAGE+'-pending','false');render();}
  }
  function startPolling(){clearInterval(syncTimer);if(auth&&settings.workspaceId)syncTimer=setInterval(()=>{if(!document.hidden)loadCloud().catch(()=>{});},10000);}
  async function subscribePush(){
    if(!auth||!settings.workspaceId)throw new Error('Connectez Supabase et un espace avant d’enregistrer un appareil.');
    const key=$('#vapid-key').value.trim();if(!key)throw new Error('Indiquez la clé publique VAPID de votre service d’envoi.');
    await enableNotifications();const registration=await swReady();if(!registration.pushManager)throw new Error('Push indisponible. Sur iPhone, ajoutez d’abord l’application à l’écran d’accueil.');
    const base64=key.replace(/-/g,'+').replace(/_/g,'/'),padded=base64+'='.repeat((4-base64.length%4)%4),publicKey=Uint8Array.from(atob(padded),character=>character.charCodeAt(0));
    const existing=await registration.pushManager.getSubscription();if(existing&&settings.vapidKey&&settings.vapidKey!==key)throw new Error('Cet appareil est déjà abonné avec une autre clé VAPID.');
    const subscription=existing||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
    await rpc('register_beta_push',{p_id:settings.workspaceId,p_subscription:subscription.toJSON()});settings.vapidKey=key;storeSettings();say('Appareil enregistré. Le serveur d’envoi reste à configurer.');
  }
  function applyHash(){const parameters=new URLSearchParams(location.hash.slice(1));if(parameters.has('event')){const requested=parameters.get('event');if(state.events.some(event=>event.id===requested))eventId=requested;else{eventId=null;say('Événement absent de ce navigateur. Connectez l’espace partagé ou restaurez sa sauvegarde.');}}else if(parameters.has('group')){const requested=parameters.get('group');if(state.groups.some(group=>group.id===requested)){groupFilter=requested;eventId=null;page='events';}else say('Groupe absent de ce navigateur. Connectez l’espace partagé.');}else eventId=null;render();}
  window.addEventListener('hashchange',applyHash);
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install').hidden=false;});
  $('#install').addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install').hidden=true;}});
  window.addEventListener('appinstalled',()=>{$('#install').hidden=true;say('Application installée.');});
  if('serviceWorker'in navigator&&['https:','http:'].includes(location.protocol))navigator.serviceWorker.register('./sw.js').catch(()=>{});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&auth&&settings.workspaceId){if(dirty)syncSave();else loadCloud().catch(()=>{});}});
  window.addEventListener('online',()=>{if(dirty)syncSave();else loadCloud().catch(()=>{});});
  applyHash();
  try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{say('Stockage local indisponible. Exportez régulièrement les données.');}
  if(auth&&settings.workspaceId){if(localStorage.getItem(STORAGE+'-pending')==='true'){dirty=true;conflict=true;updateSaveStatus();say('Modifications locales non synchronisées conservées. Exportez-les puis rechargez Supabase dans les réglages.');}else loadCloud(true).then(()=>{applyHash();startPolling();}).catch(err=>{conflict=true;updateSaveStatus();say('Mode local conservé : '+err.message);});}
})();
