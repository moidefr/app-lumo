(function(root){
  'use strict';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  function pooled(event,leg){
    const cars=event.offers.filter(car=>car.legs[leg].enabled);
    const onboard=new Set(cars.flatMap(car=>car.onboard));
    const reservations=HandCore.activeAttendees(event).filter(a=>a.transport[leg]==='confirmed'&&!onboard.has(a.memberId)).length;
    const capacity=cars.reduce((s,c)=>s+c.legs[leg].offered-c.legs[leg].reserved,0);
    return {cars,onboard,reservations,capacity,free:capacity-reservations,taken:onboard.size+reservations};
  }
  function allocations(event,leg){let remaining=pooled(event,leg).reservations;const result={};for(const car of [...event.offers].sort((a,b)=>Number(!!a.backup)-Number(!!b.backup))){if(!car.legs[leg].enabled)continue;const count=Math.min(remaining,car.legs[leg].offered-car.legs[leg].reserved);remaining-=count;result[car.id]=count;}return result;}
  function canStandby(event,car,leg){const p=pooled(event,leg),need=HandCore.activeAttendees(event).filter(a=>a.transport[leg]==='need').length;return !!car.backup&&car.legs[leg].enabled&&p.capacity-car.legs[leg].offered+car.legs[leg].reserved>=p.reservations+need+car.onboard.length;}
  function validatePool(state){HandCore.validateState(state);for(const e of state.events)if(e.transportMode==='pool')for(const leg of ['outbound','return']){if(pooled(e,leg).free<0)throw new Error('Pas assez de places '+(leg==='outbound'?'à l’aller':'au retour')+'. Ajoutez une voiture ou retirez une réservation.');for(const car of e.offers)if(car.legs[leg].enabled&&car.onboard.some(id=>!HandCore.activeAttendees(e).some(a=>a.memberId===id)))throw new Error('Un passager déjà présent est absent ou non convoqué.');}return state;}
  function prepareDemo(state){const s=clone(state);for(const e of s.events){e.transportMode='pool';for(const c of e.offers){c.ownerUserId='demo';c.backup=!!c.backup;for(const leg of ['outbound','return'])c.legs[leg].reserved=0;}for(const leg of ['outbound','return'])if(pooled(e,leg).free<0){for(const a of HandCore.activeAttendees(e).reverse()){if(pooled(e,leg).free>=0)break;if(a.transport[leg]==='confirmed'&&!pooled(e,leg).onboard.has(a.memberId))a.transport[leg]='need';}}}return validatePool(s);}
  // Three-way merge: disjoint edits combine; competing edits to one field do not overwrite.
  function merge(base,local,remote,path=''){
    if(same(local,base))return clone(remote);if(same(remote,base)||same(local,remote))return clone(local);
    if(Array.isArray(base)&&Array.isArray(local)&&Array.isArray(remote)){
      const field=[...base,...local,...remote].every(x=>x&&typeof x==='object'&&typeof(x.id||x.memberId)==='string')?([...base,...local,...remote].some(x=>x.id)?'id':'memberId'):null;
      if(field){const keys=[...new Set([...remote,...local].map(x=>x[field]))],maps=[base,local,remote].map(xs=>new Map(xs.map(x=>[x[field],x])));return keys.map(k=>merge(...maps.map(m=>m.get(k)),path+'/'+k)).filter(x=>x!==undefined);}
      if([...base,...local,...remote].every(x=>typeof x==='string')){const removed=new Set(base.filter(x=>!local.includes(x)||!remote.includes(x)));return [...new Set([...remote,...local])].filter(x=>!removed.has(x));}
    }
    if(base&&local&&remote&&[base,local,remote].every(x=>typeof x==='object'&&!Array.isArray(x))){const result={};for(const k of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){const v=merge(base[k],local[k],remote[k],path+'/'+k);if(v!==undefined)result[k]=v;}return result;}
    throw Object.assign(new Error('Ces informations ont aussi été modifiées par quelqu’un d’autre. Choisissez la version à garder.'),{conflictPath:path});
  }
  const api={pooled,allocations,canStandby,validatePool,prepareDemo,merge};root.LumoDomain=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
