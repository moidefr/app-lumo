(function (root) {
  'use strict';
  const id = prefix => prefix + '-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const transportLabels = {unknown:'À renseigner',need:'Cherche une place',confirmed:'Transport confirmé',parent:'Avec ses parents'};
  function dayString(date) {return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
  function seed() {
    const day=new Date();day.setDate(day.getDate()+6);
    const date=dayString(day);
    const state={version:1,clubName:'Club de hand · démo',groups:[{id:'g13',name:'−13 filles',parentId:null},{id:'g15',name:'−15 garçons',parentId:null},{id:'ggervanne',name:'Secteur Gervanne',parentId:'g13'}],members:[
      {id:'lea',name:'Léa Martin',kind:'child',parentName:'Sophie Martin',groups:['g13','ggervanne']},
      {id:'hugo',name:'Hugo Martin',kind:'child',parentName:'Sophie Martin',groups:['g15']},
      {id:'ines',name:'Inès Durand',kind:'child',parentName:'Karim Durand',groups:['g13']},
      {id:'adam',name:'Adam Petit',kind:'child',parentName:'Marie Petit',groups:['g15']},
      {id:'emma',name:'Emma Robert',kind:'child',parentName:'Julie Robert',groups:['g13']},
      {id:'karim',name:'Karim Durand',kind:'adult',parentName:'Parent d’Inès',groups:['g13']}
    ],events:[],notifications:[]};
    const event={id:'match-demo',title:'Match amical intergroupes',type:'match',groups:['g13','g15'],date,time:'14:00',meetingTime:'12:45',meetingAddress:'Parking du club',address:'Gymnase municipal · adresse à préciser',notes:'Événement fictif pour tester la bêta.',cancelled:false,source:null,rosterPublished:false,attendees:[],offers:[{id:'car-sophie',driver:'Sophie Martin',parentOf:'Léa et Hugo',totalSeats:5,onboard:['lea','hugo'],legs:{outbound:{enabled:true,offered:2,reserved:1},return:{enabled:true,offered:2,reserved:0}}}],missions:[]};
    event.attendees=state.members.map(member=>({memberId:member.id,availability:member.id==='emma'?'unknown':'present',selected:true,team:'Équipe A',transport:{outbound:['lea','hugo'].includes(member.id)?'parent':member.id==='ines'?'confirmed':'need',return:['lea','hugo'].includes(member.id)?'parent':'need'}}));
    ['Arbitre','Table de marque','Responsable de salle','Buvette','Gâteaux','Goûter','Apporter les maillots','Laver les maillots','Accompagner le coach'].forEach(name=>event.missions.push({id:id('mission'),name,needed:1,assigned:[]}));
    state.events.push(event);
    return state;
  }
  function descendants(state, groupIds) {
    const ids=new Set(groupIds);let changed=true;
    while(changed){changed=false;for(const group of state.groups)if(group.parentId&&ids.has(group.parentId)&&!ids.has(group.id)){ids.add(group.id);changed=true;}}
    return ids;
  }
  function groupMembers(state, groupIds) {const ids=descendants(state,groupIds);return state.members.filter(member=>member.groups.some(group=>ids.has(group)));}
  function defaultsFor(member,type) {
    const all=member?.defaults;
    if(!all||typeof all!=='object')return null;
    const scoped=all[type];
    return scoped&&typeof scoped==='object'?scoped:type==='training'?all:null;
  }
  function applyDefaults(attendee,member,type) {
    const d=defaultsFor(member,type);if(!d||attendee.answeredAt)return attendee;
    const presence=d.presence??d.availability;
    if(attendee.availability==='unknown'&&['present','absent'].includes(presence))attendee.availability=presence;
    for(const leg of ['outbound','return'])if(attendee.transport[leg]==='unknown'&&['parent','need'].includes(d.transport?.[leg]))attendee.transport[leg]=d.transport[leg];
    return attendee;
  }
  function newAttendee(memberId,member,type='match') {
    const attendee=applyDefaults({memberId,availability:'unknown',selected:true,team:'',transport:{outbound:'unknown',return:'unknown'}},member,type);
    if(type!=='training')for(const leg of ['outbound','return'])if(attendee.transport[leg]==='unknown')attendee.transport[leg]='need';
    return attendee;
  }
  function activeAttendees(event) {return event.attendees.filter(attendee=>attendee.selected&&attendee.availability!=='absent');}
  function capacity(event,leg) {
    const offers=event.offers.filter(offer=>offer.legs[leg].enabled);
    return {free:offers.reduce((sum,offer)=>sum+offer.legs[leg].offered-offer.legs[leg].reserved,0),taken:offers.reduce((sum,offer)=>sum+offer.onboard.length+offer.legs[leg].reserved,0)};
  }
  // Les enfants qui cherchent une place remplissent automatiquement les places libres, dans l'ordre des demandes.
  function allocate(state,event,leg) {
    const training=event.type==='training',isInvited=a=>a.transport.outbound!=='unknown'||a.transport.return!=='unknown';
    const cars=event.offers.filter(c=>c.legs[leg].enabled),onboard=new Set(cars.flatMap(c=>c.onboard));
    const kids=activeAttendees(event).filter(a=>state.members.find(m=>m.id===a.memberId)?.kind==='child'&&(!training||isInvited(a)||onboard.has(a.memberId)));
    const cap=cars.reduce((sum,c)=>sum+c.legs[leg].offered,0);
    const covered=kids.filter(a=>onboard.has(a.memberId)||a.transport[leg]==='parent');
    const asking=kids.filter(a=>!covered.includes(a)&&(['need','confirmed'].includes(a.transport[leg])||(!training&&a.transport[leg]==='unknown'))).map((a,i)=>[a,i]).sort((x,y)=>{const p=x[0].answeredAt||'~',q=y[0].answeredAt||'~';return p<q?-1:p>q?1:x[1]-y[1];}).map(x=>x[0]);
    const placed=asking.slice(0,cap),waiting=asking.slice(cap),unanswered=kids.filter(a=>!covered.includes(a)&&training&&a.transport[leg]==='unknown');
    return {kids,covered,placed,waiting,unanswered,cap,free:Math.max(0,cap-placed.length),served:covered.length+placed.length};
  }
  function transportSummary(state,event,leg) {
    const attendees=activeAttendees(event),children=attendees.filter(attendee=>state.members.find(member=>member.id===attendee.memberId)?.kind==='child');
    return {...capacity(event,leg),people:attendees.length,confirmedPeople:attendees.filter(attendee=>['confirmed','parent'].includes(attendee.transport[leg])).length,children:children.length,confirmed:children.filter(attendee=>['confirmed','parent'].includes(attendee.transport[leg])).length,need:attendees.filter(attendee=>attendee.transport[leg]==='need').length,unknown:attendees.filter(attendee=>attendee.transport[leg]==='unknown').length,served:allocate(state,event,leg).served,waiting:allocate(state,event,leg).waiting.length+allocate(state,event,leg).unanswered.length};
  }
  function checkOffer(offer) {
    if(!Number.isInteger(offer.totalSeats)||offer.totalSeats<2||offer.totalSeats>9)throw new Error('Une voiture doit avoir de 2 à 9 places, conducteur compris.');
    if(new Set(offer.onboard).size!==offer.onboard.length||offer.onboard.length>offer.totalSeats-1)throw new Error('Trop de passagers déjà présents dans la voiture.');
    if(!offer.driver.trim())throw new Error('Indiquez le conducteur.');
    for(const leg of Object.values(offer.legs)){
      if(!Number.isInteger(leg.offered)||!Number.isInteger(leg.reserved)||leg.offered<0||leg.reserved<0||leg.reserved>leg.offered||leg.offered+offer.onboard.length>offer.totalSeats-1)throw new Error('Les places proposées ou prises dépassent la capacité de la voiture.');
    }
  }
  function parisDateTime(value,zone='Europe/Paris') {
    const match=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
    if(!match)throw new Error('Date iCal non reconnue : '+value);
    const parts=match.slice(1,7).map(part=>Number(part||0));
    const guessed=Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]);
    const validDate=new Date(guessed);
    if(validDate.getUTCFullYear()!==parts[0]||validDate.getUTCMonth()!==parts[1]-1||validDate.getUTCDate()!==parts[2]||parts[3]>23||parts[4]>59||parts[5]>59)throw new Error('Date ou heure iCal invalide.');
    const sourceZone=match[7]?'UTC':zone;
    const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:sourceZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    let instant=guessed;
    for(let iteration=0;iteration<4;iteration++){
      const rendered=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
      const displayed=Date.UTC(+rendered.year,+rendered.month-1,+rendered.day,+rendered.hour,+rendered.minute,+rendered.second);
      const delta=guessed-displayed;if(!delta)break;instant+=delta;
    }
    const check=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
    if(Date.UTC(+check.year,+check.month-1,+check.day,+check.hour,+check.minute,+check.second)!==guessed)throw new Error('Date ou heure iCal invalide.');
    const result=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
    return {date:`${result.year}-${result.month}-${result.day}`,time:`${result.hour}:${result.minute}`};
  }
  const unescapeIcs=value=>value.replace(/\\[nN]/g,'\n').replace(/\\([,;\\])/g,'$1');
  function parseIcs(text) {
    if(text.length>2000000)throw new Error('Le calendrier est trop volumineux (maximum 2 Mo).');
    const lines=text.replace(/^\uFEFF/,'').replace(/\r\n[ \t]|\n[ \t]/g,'').split(/\r?\n/);
    if(!lines.some(line=>line==='BEGIN:VCALENDAR'))throw new Error('Ce fichier n’est pas un calendrier iCal.');
    const records=[];let entry=null;let invalid=0;
    for(const line of lines){
      if(line==='BEGIN:VEVENT'){entry={};continue;}
      if(line==='END:VEVENT'){
        if(entry){try{
          if(!entry.DTSTART||!entry.SUMMARY)throw new Error('Rencontre sans date ou titre.');
          const raw=entry.DTSTART.value;
          let datetime;
          if(/^\d{8}$/.test(raw)){
            datetime={date:raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8),time:''};
            if(!/^\d{4}-\d{2}-\d{2}$/.test(datetime.date)||new Date(datetime.date+'T12:00:00Z').toISOString().slice(0,10)!==datetime.date)throw new Error('Date invalide.');
          } else datetime=parisDateTime(raw,entry.DTSTART.params.TZID||'Europe/Paris');
          const url=entry.URL?.value||'';
          const externalId=/\/rencontre-(\d+)/.exec(url)?.[1];
          const uid=entry.UID?.value;
          if(!externalId&&!uid)throw new Error('Identifiant manquant.');
          records.push({...datetime,title:unescapeIcs(entry.SUMMARY.value),address:unescapeIcs(entry.LOCATION?.value||''),description:unescapeIcs(entry.DESCRIPTION?.value||''),url,uid:uid||'',externalId:externalId||'',key:externalId?'ffhandball:'+externalId:'ical:'+uid,cancelled:entry.STATUS?.value==='CANCELLED'});
        }catch{invalid++;}}entry=null;continue;
      }
      if(entry){const colon=line.indexOf(':');if(colon<0)continue;const spec=line.slice(0,colon).split(';');const name=spec.shift().toUpperCase();const params={};for(const parameter of spec){const eq=parameter.indexOf('=');if(eq>0)params[parameter.slice(0,eq)]=parameter.slice(eq+1).replace(/^"|"$/g,'');}entry[name]={value:line.slice(colon+1),params};}
    }
    if(entry)invalid++;
    if(!records.length)throw new Error('Aucune rencontre exploitable dans ce fichier.');
    return {records,invalid};
  }
  function importRecords(state,records,groupId,filter='') {
    if(!state.groups.some(group=>group.id===groupId))throw new Error('Choisissez un groupe existant.');
    const selected=records.filter(record=>!filter||record.title.toLocaleLowerCase('fr').includes(filter.toLocaleLowerCase('fr')));
    let added=0,updated=0,unchanged=0;const changed=[];
    const unique=new Map(selected.map(record=>[record.key,record]));
    for(const record of unique.values()){
      let event=state.events.find(item=>item.source?.key===record.key);
      if(event){
        const hasChanged=['title','date','time','address','cancelled'].some(field=>event[field]!==record[field]);
        const addGroup=!event.groups.includes(groupId);
        Object.assign(event,{title:record.title,date:record.date,time:record.time,address:record.address,cancelled:record.cancelled});
        if(addGroup){event.groups.push(groupId);for(const member of groupMembers(state,[groupId]))if(!event.attendees.some(item=>item.memberId===member.id))event.attendees.push(newAttendee(member.id));}
        event.source={...record,syncedAt:new Date().toISOString()};
        if(hasChanged||addGroup){updated++;changed.push(event.id);}else unchanged++;
      }else{
        event={id:id('event'),title:record.title,type:'match',groups:[groupId],date:record.date,time:record.time,meetingTime:'',meetingAddress:'',address:record.address,notes:record.description,cancelled:record.cancelled,source:{...record,syncedAt:new Date().toISOString()},rosterPublished:false,attendees:groupMembers(state,[groupId]).map(member=>newAttendee(member.id)),offers:[],missions:[]};
        state.events.push(event);added++;
      }
    }
    return {added,updated,unchanged,changed};
  }
  function validateState(state) {
    if(!state||state.version!==1||typeof state.clubName!=='string')throw new Error('Sauvegarde incompatible.');
    for(const key of ['groups','members','events','notifications'])if(!Array.isArray(state[key])||state[key].length>10000)throw new Error('Sauvegarde invalide.');
    for(const key of ['groups','members','events']){
      const ids=new Set();for(const item of state[key]){if(!item||typeof item.id!=='string'||ids.has(item.id))throw new Error('Identifiant invalide ou dupliqué.');ids.add(item.id);}
    }
    const groups=new Set(state.groups.map(item=>item.id));const members=new Set(state.members.map(item=>item.id));
    for(const group of state.groups){if(typeof group.name!=='string'||(group.parentId&&!groups.has(group.parentId)))throw new Error('Groupe invalide.');const seen=new Set([group.id]);let parent=group.parentId;while(parent){if(seen.has(parent))throw new Error('Hiérarchie de groupes invalide.');seen.add(parent);parent=state.groups.find(item=>item.id===parent)?.parentId;}}
    const validDefaults=d=>d&&typeof d==='object'&&(!d.presence||['present','absent'].includes(d.presence))&&(!d.availability||['present','absent'].includes(d.availability))&&(!d.transport||typeof d.transport==='object')&&['outbound','return'].every(leg=>!d.transport?.[leg]||['parent','need'].includes(d.transport[leg]));
    for(const member of state.members)if(member.defaults!==undefined&&(!member.defaults||typeof member.defaults!=='object'||!validDefaults(member.defaults)||(member.defaults.training!==undefined&&!validDefaults(member.defaults.training))||(member.defaults.match!==undefined&&!validDefaults(member.defaults.match))))throw new Error('Réponse habituelle invalide.');
    for(const member of state.members)if(typeof member.name!=='string'||typeof member.parentName!=='string'||!['child','adult'].includes(member.kind)||!Array.isArray(member.groups)||member.groups.some(group=>!groups.has(group)))throw new Error('Participant invalide.');
    for(const event of state.events){
      if(typeof event.title!=='string'||!Array.isArray(event.groups)||event.groups.some(group=>!groups.has(group))||!Array.isArray(event.attendees)||!Array.isArray(event.offers)||!Array.isArray(event.missions)||typeof event.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||!['match','training','special'].includes(event.type))throw new Error('Événement invalide.');
      if(new Set(event.attendees.map(item=>item.memberId)).size!==event.attendees.length)throw new Error('Participant dupliqué dans un événement.');
      for(const attendee of event.attendees)if(!members.has(attendee.memberId)||!['present','absent','unknown'].includes(attendee.availability)||typeof attendee.selected!=='boolean'||!attendee.transport||!transportLabels[attendee.transport.outbound]||!transportLabels[attendee.transport.return])throw new Error('Réponse transport invalide.');
      const onboardByLeg={outbound:new Set(),return:new Set()};
      for(const offer of event.offers){if(!Array.isArray(offer.onboard)||offer.onboard.some(member=>!members.has(member))||!offer.legs?.outbound||!offer.legs?.return||typeof offer.driver!=='string')throw new Error('Voiture invalide.');checkOffer(offer);for(const leg of ['outbound','return'])if(offer.legs[leg].enabled)for(const member of offer.onboard){if(onboardByLeg[leg].has(member))throw new Error('Un participant est présent dans plusieurs voitures pour le même trajet.');onboardByLeg[leg].add(member);}}
      for(const mission of event.missions)if(typeof mission.name!=='string'||!Number.isInteger(mission.needed)||mission.needed<1||mission.needed>50||!Array.isArray(mission.assigned)||new Set(mission.assigned).size!==mission.assigned.length||mission.assigned.length>mission.needed||mission.assigned.some(name=>typeof name!=='string'))throw new Error('Mission invalide.');
    }
    return state;
  }
  const api={id,clone,esc,seed,dayString,transportLabels,groupMembers,newAttendee,applyDefaults,allocate,activeAttendees,capacity,transportSummary,checkOffer,parseIcs,importRecords,validateState,parisDateTime};
  root.HandCore=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
