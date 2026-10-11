(() => {
  'use strict';
  const $=s=>document.querySelector(s), model=window.LumoFleet;
  let state=model.createDemo(),leg='outbound',personId='ines';
  const skinNames={classic:'Essentiel',sport:'Rallye',night:'Nuit électrique'};
  function say(text){const toast=$('#toast');toast.textContent=text;toast.hidden=false;clearTimeout(say.timer);say.timer=setTimeout(()=>toast.hidden=true,4500);}
  function message(text){$('#demo-message').textContent=text;}
  function firstName(person){return person.name.split(' ')[0];}
  function names(ids){return ids.map(id=>state.cars.find(c=>c.id===id).driver).join(' et ');}
  function carDrawing(car){
    const capacity=car[leg].capacity,onboard=car.onboard.length;
    const seats=[['driver','D'],...Array.from({length:4},(_,i)=>i<onboard?['onboard','✓']:i<capacity?['offered','+']:['unoffered','—'])];
    return '<div class="windscreen" aria-hidden="true"></div><div class="car-seats" aria-hidden="true">'+seats.map(s=>'<span class="seat '+s[0]+'">'+s[1]+'</span>').join('')+'</div>';
  }
  function labelCar(car){return 'Voiture de '+car.driver+', '+(car[leg].standby?'en réserve, ':'active, ')+car[leg].capacity+' places pour les jeunes, '+car.onboard.length+' enfant déjà à bord, skin '+skinNames[car.skin]+'. Aucune réservation commune attribuée à ce véhicule.';}
  function renderFleet(){
    $('#fleet').innerHTML=state.cars.map(car=>{
      const trip=car[leg],pinned=car.onboard.length>0;
      return '<article class="vehicle-card'+(trip.standby?' is-standby':'')+'" data-car="'+car.id+'"><p class="vehicle-status">'+(trip.standby?'En réserve':trip.conditional?'Si besoin':'Je viens')+'</p><h5>'+car.driver+'</h5><p class="vehicle-parent">'+car.parent+'</p><div class="vehicle" role="img" data-skin="'+car.skin+'" style="--paint:'+car.paint+'" aria-label="'+labelCar(car)+'">'+carDrawing(car)+'</div><p class="vehicle-capacity">'+trip.capacity+' places pour les jeunes</p><p class="onboard-note">'+(pinned?car.onboard.join(', ')+' déjà à bord':trip.standby?'Disponible en renfort':(trip.capacity<4?(4-trip.capacity)+' place'+(4-trip.capacity>1?'s':'')+' non proposée'+(4-trip.capacity>1?'s':''):'Toutes les places sont proposées'))+'</p><label class="check-label"><input type="checkbox" data-conditional="'+car.id+'" aria-label="'+car.driver+' vient seulement si besoin au '+(leg==='outbound'?'trajet aller':'trajet retour')+'" '+(trip.conditional?'checked ':'')+(pinned?'disabled ':'')+'>'+ (pinned?'Enfant déjà à bord':'Je viens si besoin')+'</label>'+(trip.standby?'<button class="small-button" data-restore="'+car.id+'">Réactiver '+car.driver+'</button>':'')+'<details class="customise"><summary>Personnaliser</summary><label>Skin<select data-skin-select="'+car.id+'" aria-label="Skin de '+car.driver+'">'+Object.entries(skinNames).map(([key,name])=>'<option value="'+key+'" '+(key===car.skin?'selected':'')+'>'+name+'</option>').join('')+'</select></label><label>Peinture<input type="color" data-paint="'+car.id+'" value="'+car.paint+'" aria-label="Peinture de '+car.driver+'"></label></details></article>';
    }).join('');
    $('#fleet').querySelectorAll('[data-conditional]').forEach(input=>input.addEventListener('change',()=>{model.setConditional(state,input.dataset.conditional,leg,input.checked);render();message('Présence de '+state.cars.find(c=>c.id===input.dataset.conditional).driver+' mise à jour pour ce trajet.');}));
    $('#fleet').querySelectorAll('[data-restore]').forEach(button=>button.addEventListener('click',()=>{model.restore(state,button.dataset.restore,leg);render();message('Voiture réactivée pour ce trajet. Les réservations restent communes.');}));
    $('#fleet').querySelectorAll('[data-skin-select],[data-paint]').forEach(input=>input.addEventListener('input',()=>{
      const id=input.dataset.skinSelect||input.dataset.paint,car=state.cars.find(c=>c.id===id);
      if(input.dataset.skinSelect&&Object.hasOwn(skinNames,input.value))car.skin=input.value;
      if(input.dataset.paint&&/^#[a-f0-9]{6}$/i.test(input.value))car.paint=input.value;
      const drawing=input.closest('article').querySelector('.vehicle');drawing.dataset.skin=car.skin;drawing.style.setProperty('--paint',car.paint);drawing.setAttribute('aria-label',labelCar(car));
    }));
  }
  function render(){
    for(const journey of ['outbound','return']){
      const info=model.summary(state,journey),prefix=journey==='outbound'?'out':'back';
      $('#'+prefix+'-count').textContent=info.confirmed+' sur '+info.total+' jeunes';
      $('#'+prefix+'-desc').textContent=info.missing?info.missing+' inscription'+(info.missing>1?'s':'')+' à confirmer':'Tout le monde est transporté';
      $('#summary-'+prefix).classList.toggle('complete',info.missing===0);
    }
    const info=model.summary(state,leg),proposal=model.plan(state,leg),person=state.people.find(p=>p.id===personId);
    $('#capacity-count').textContent=info.capacity;$('#reserved-count').textContent=info.confirmed;$('#free-count').textContent=info.free;
    $('#capacity-count').nextElementSibling.textContent=info.capacity===1?'place au total':'places au total';
    $('#reserved-count').nextElementSibling.textContent=info.confirmed===1?'place réservée':'places réservées';
    $('#free-count').nextElementSibling.textContent=info.free===1?'place libre':'places libres';
    $('#fleet-count').textContent=info.active+' active'+(info.active>1?'s':'')+(info.standby?' · '+info.standby+' en réserve':'');
    $('#reserve').textContent=(person[leg]==='confirmed'?'Annuler pour ':'Réserver pour ')+firstName(person);
    $('#reserve').classList.toggle('secondary',person[leg]==='confirmed');$('#reserve').classList.toggle('primary',person[leg]!=='confirmed');
    $('#reserve').disabled=person[leg]!=='confirmed'&&info.free===0;
    $('#booking-person').value=personId;
    if(proposal.shortage){$('#plan-title').textContent='Il manque des places.';$('#plan-detail').textContent='Les '+info.active+' voitures offrent '+info.capacity+' places pour '+info.total+' jeunes. Un renfort est nécessaire.';}
    else if(proposal.remove.length){$('#plan-title').textContent=info.total+' jeunes tiennent dans '+proposal.needed+' voitures.';$('#plan-detail').textContent=names(proposal.remove)+' '+(proposal.remove.length>1?'peuvent':'peut')+' rester en réserve : '+proposal.capacity+' places sont conservées pour ce trajet.';}
    else if(info.standby){$('#plan-title').textContent='Les '+info.active+' voitures suffisent.';$('#plan-detail').textContent=info.capacity+' places pour '+info.total+' jeunes. '+names(state.cars.filter(c=>c[leg].standby).map(c=>c.id))+' '+(info.standby>1?'restent':'reste')+' disponible'+(info.standby>1?'s':'')+' en renfort.';}
    else{$('#plan-title').textContent='On garde les '+info.active+' voitures.';$('#plan-detail').textContent='Aucune voiture « si besoin » ne peut être mise en réserve en conservant assez de places pour tous.';}
    $('#apply-plan').textContent=proposal.remove.length?'Mettre '+proposal.remove.length+' voiture'+(proposal.remove.length>1?'s':'')+' en réserve':'Aucun regroupement à appliquer';
    $('#apply-plan').disabled=proposal.remove.length===0;
    $('#roster').innerHTML=state.people.map(p=>'<div class="person-row"><div><strong>'+p.name+'</strong><small>'+p.parent+'</small></div><span class="status '+(p[leg]==='confirmed'?'confirmed':'need')+'">'+(p[leg]==='confirmed'?'✓ Transport confirmé':'! Cherche une place')+'</span></div>').join('');
    document.querySelectorAll('[data-leg]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.leg===leg)));
    renderFleet();
  }
  function options(){
    $('#booking-person').replaceChildren(...state.people.filter(p=>p.id!=='lea').map(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.name;return option;}));
  }
  $('#booking-person').addEventListener('change',event=>{personId=event.target.value;render();message('');});
  $('#reserve').addEventListener('click',()=>{
    const person=state.people.find(p=>p.id===personId),trip=leg==='outbound'?'aller':'retour';
    if(person[leg]==='confirmed'){model.release(state,personId,leg);message('Réservation '+trip+' annulée pour '+firstName(person)+'.');}
    else if(model.reserve(state,personId,leg))message('Transport '+trip+' confirmé pour '+firstName(person)+'. Aucune voiture attribuée.');
    else message('Toutes les places proposées sont déjà réservées. Un véhicule supplémentaire est nécessaire.');
    render();
  });
  $('#apply-plan').addEventListener('click',()=>{const proposal=model.applyPlan(state,leg);render();message(proposal.remove.length?names(proposal.remove)+' '+(proposal.remove.length>1?'restent':'reste')+' en réserve pour '+(leg==='outbound'?'l’aller':'le retour')+'. Les transports confirmés sont conservés.':'Les disponibilités ont changé : aucun regroupement à appliquer.');});
  document.querySelectorAll('[data-leg]').forEach(button=>button.addEventListener('click',()=>{leg=button.dataset.leg;message('');render();}));
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{$('#app-preview').classList.toggle('mobile',button.dataset.view==='mobile');document.querySelectorAll('[data-view]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));}));
  document.querySelectorAll('[data-message]').forEach(button=>button.addEventListener('click',()=>say(button.dataset.message)));
  document.querySelectorAll('[data-hex]').forEach(button=>button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(button.dataset.hex);say(button.dataset.hex+' copié.');}catch{say('Code couleur : '+button.dataset.hex);}}));
  $('#reset-demo').addEventListener('click',()=>{state=model.createDemo();leg='outbound';personId='ines';options();render();message('Exemple réinitialisé.');});
  options();render();
})();
