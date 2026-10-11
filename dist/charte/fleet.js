(function(root){
  'use strict';
  const legs=['outbound','return'];
  function createDemo(){return {
    people:[
      {id:'lea',name:'Léa Martin',parent:'Sophie Martin',outbound:'confirmed',return:'confirmed'},
      {id:'ines',name:'Inès Durand',parent:'Karim Durand',outbound:'need',return:'need'},
      {id:'emma',name:'Emma Robert',parent:'Julie Robert',outbound:'confirmed',return:'confirmed'},
      {id:'chloe',name:'Chloé Bernard',parent:'Camille Bernard',outbound:'confirmed',return:'confirmed'},
      {id:'lou',name:'Lou Morel',parent:'Thomas Morel',outbound:'confirmed',return:'need'},
      {id:'manon',name:'Manon Roux',parent:'Claire Roux',outbound:'confirmed',return:'need'},
      {id:'jade',name:'Jade Perrin',parent:'Nicolas Perrin',outbound:'need',return:'need'},
      {id:'alice',name:'Alice Faure',parent:'Élodie Faure',outbound:'confirmed',return:'confirmed'}
    ],
    cars:[
      {id:'sophie',driver:'Sophie',fullName:'Sophie Martin',parent:'Parent de Léa',onboard:['Léa'],skin:'classic',paint:'#007F87',outbound:{capacity:4,conditional:false,standby:false},return:{capacity:4,conditional:false,standby:false}},
      {id:'thomas',driver:'Thomas',fullName:'Thomas Morel',parent:'Parent de Lou',onboard:[],skin:'sport',paint:'#1D4ED8',outbound:{capacity:4,conditional:false,standby:false},return:{capacity:2,conditional:false,standby:false}},
      {id:'julie',driver:'Julie',fullName:'Julie Robert',parent:'Parent d’Emma',onboard:[],skin:'night',paint:'#007F87',outbound:{capacity:3,conditional:true,standby:false},return:{capacity:2,conditional:true,standby:false}},
      {id:'karim',driver:'Karim',fullName:'Karim Durand',parent:'Parent d’Inès',onboard:[],skin:'sport',paint:'#007F87',outbound:{capacity:3,conditional:true,standby:false},return:{capacity:2,conditional:true,standby:false}}
    ]
  };}
  function summary(state,leg){
    if(!legs.includes(leg))throw Error('Trajet inconnu');
    const active=state.cars.filter(c=>!c[leg].standby),capacity=active.reduce((n,c)=>n+c[leg].capacity,0);
    const confirmed=state.people.filter(p=>p[leg]==='confirmed').length;
    return {total:state.people.length,confirmed,capacity,free:Math.max(0,capacity-confirmed),missing:state.people.length-confirmed,active:active.length,standby:state.cars.length-active.length};
  }
  function plan(state,leg){
    const active=state.cars.filter(c=>!c[leg].standby),required=state.people.length;
    const mandatory=active.filter(c=>!c[leg].conditional||c.onboard.length),optional=active.filter(c=>c[leg].conditional&&!c.onboard.length);
    let best=null;
    for(let mask=0;mask<(1<<optional.length);mask++){
      const kept=[...mandatory,...optional.filter((_,i)=>mask&(1<<i))],capacity=kept.reduce((n,c)=>n+c[leg].capacity,0);
      if(capacity>=required&&(!best||kept.length<best.kept.length||(kept.length===best.kept.length&&capacity>best.capacity)))best={kept,capacity};
    }
    if(!best)return {remove:[],needed:active.length,capacity:summary(state,leg).capacity,required,shortage:true};
    return {remove:optional.filter(c=>!best.kept.includes(c)).map(c=>c.id),needed:best.kept.length,capacity:best.capacity,required,shortage:false};
  }
  function reserve(state,id,leg){
    const person=state.people.find(p=>p.id===id);if(!person)throw Error('Participant inconnu');
    if(person[leg]==='confirmed')return false;
    if(summary(state,leg).free===0)return false;
    person[leg]='confirmed';return true;
  }
  function release(state,id,leg){const person=state.people.find(p=>p.id===id);if(!person)throw Error('Participant inconnu');person[leg]='need';}
  function applyPlan(state,leg){const proposal=plan(state,leg);proposal.remove.forEach(id=>{state.cars.find(c=>c.id===id)[leg].standby=true;});return proposal;}
  function restore(state,id,leg){state.cars.find(c=>c.id===id)[leg].standby=false;}
  function setConditional(state,id,leg,value){const car=state.cars.find(c=>c.id===id);car[leg].conditional=Boolean(value);if(!value)car[leg].standby=false;}
  const api={createDemo,summary,plan,reserve,release,applyPlan,restore,setConditional};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LumoFleet=api;
})(typeof globalThis!=='undefined'?globalThis:this);
