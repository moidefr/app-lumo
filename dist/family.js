/* Lumo · espace famille : accès par lien, sans compte. Tout se fait depuis l'accueil. */
(() => {
  'use strict';
  const found = /(?:^|[#&])f=([A-Za-z0-9_-]{16,128})/.exec(location.hash);
  if (!found) return;
  const token = found[1];
  window.__lumoFamily = true;
  document.documentElement.classList.add('family');

  const C = HandCore, D = LumoDomain, Cloud = LumoCloud, E = C.esc;
  const LEGS = [['outbound', 'Aller'], ['return', 'Retour']];
  const $ = s => document.querySelector(s);
  const storeKey = 'lumo-f:' + token.slice(0, 12);
  let store = { mine: [], name: '' };
  try { store = { ...store, ...JSON.parse(localStorage.getItem(storeKey) || '{}') }; } catch {}
  const openHelp = new Set(); let failures = 0, state = null, base = null, revision = 0, clubName = '', dirty = false, saving = false, timer = null, screen = 'loading', error = '', changing = false, search = '', pickDraft = [];
  let dialogEvent = null;

  const remember = () => { try { localStorage.setItem(storeKey, JSON.stringify(store)); } catch {} };
  const DEMO = token === 'demo-lumo-essai-0000';
  const demoKey = 'lumo-f-demo-data';
  function demoStore() {
    try { const saved = JSON.parse(localStorage.getItem(demoKey) || 'null'); if (saved?.payload) return saved; } catch {}
    return { revision: 1, payload: D.prepareDemo(C.seedFullDemo()) };
  }
  function demoRpc(name, body) {
    const db = demoStore(), reply = () => { localStorage.setItem(demoKey, JSON.stringify(db)); return { club: { id: 'demo', name: 'Club de démonstration', revision: db.revision }, payload: db.payload }; };
    if (name === 'lumo_link_open') return reply();
    if (name === 'lumo_link_save') { db.payload = body.p_payload; db.revision++; return reply(); }
    if (name === 'lumo_link_add_child') {
      const id = 'm-' + C.id('demo'); db.payload.members.push({ id, name: body.p_name, kind: 'child', parentName: '', groups: body.p_group_ids });
      for (const e of db.payload.events) if (e.date >= today() && !e.cancelled && e.groups.some(g => body.p_group_ids.includes(g))) e.attendees.push({ memberId: id, availability: 'unknown', selected: true, team: '', transport: { outbound: 'need', return: 'need' } });
      db.revision++; return reply();
    }
    throw new Error('Action indisponible dans la démo.');
  }
  const rpc = async (name, body) => DEMO ? demoRpc(name, body) : Cloud.request('/rest/v1/rpc/' + name, { method: 'POST', body, anonymous: true });
  const mine = () => store.mine.filter(id => state.members.some(m => m.id === id));
  const member = id => state.members.find(m => m.id === id);
  const first = id => (member(id)?.name || 'Participant').split(' ')[0];
  const today = () => C.dayString(new Date());
  const day = v => v ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date(v + 'T12:00:00Z')) : 'Date à préciser';
  const upcoming = () => state.events.filter(e => e.date >= today() && !e.cancelled).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const myAttendees = e => e.attendees.filter(a => mine().includes(a.memberId) && a.selected);
  const myEvents = () => upcoming().filter(e => myAttendees(e).length);

  function say(text) {
    const box = $('#feedback'); if (!box) return;
    box.textContent = text; box.classList.add('visible');
    clearTimeout(say.t); say.t = setTimeout(() => box.classList.remove('visible'), 5000);
  }
  function indicator() {
    const el = $('#save-state'); if (!el) return;
    el.textContent = saving ? 'Enregistrement…' : dirty ? 'En attente…' : 'Enregistré';
  }

  /* ---------- données ---------- */
  function apply(result) {
    const payload = C.clone(result.payload);
    try { D.validatePool(payload); } catch { C.validateState(payload); }
    state = payload; base = C.clone(payload); revision = result.club.revision; clubName = result.club.name || '';
  }
  async function pull() { apply(await rpc('lumo_link_open', { p_token: token })); }

  function commit(fn) {
    const previous = C.clone(state);
    try { fn(); D.validatePool(state); } catch (e) { console.error(e); state = previous; render(); say(e.message || 'Action impossible.'); return false; }
    dirty = true; indicator(); render(); clearTimeout(timer); timer = setTimeout(flush, 400);
    return true;
  }
  async function flush() {
    if (saving || !dirty) return;
    saving = true; indicator();
    const snapshot = C.clone(state);
    try {
      const result = await rpc('lumo_link_save', { p_token: token, p_expected_revision: revision, p_payload: snapshot });
      base = C.clone(result.payload); revision = result.club.revision;
      dirty = JSON.stringify(state) !== JSON.stringify(snapshot); failures = 0;
    } catch (e) {
      failures++;
      if (String(e.code) === '40001' || /modifié/.test(e.message)) {
        try {
          const remote = await rpc('lumo_link_open', { p_token: token });
          try { state = D.validatePool(D.merge(base, state, remote.payload)); }
          catch { state = C.clone(remote.payload); dirty = false; say('Quelqu’un a modifié la même information : la version la plus récente est affichée.'); }
          base = C.clone(remote.payload); revision = remote.club.revision; render();
        } catch (inner) { say(inner.message); }
      } else { say(e.offline ? 'Pas de connexion : vos changements seront renvoyés.' : e.message); }
    } finally {
      saving = false; indicator();
      if (dirty && failures < 3) timer = setTimeout(flush, 1500);
    }
  }

  /* ---------- actions ---------- */
  const attendee = (e, id) => e.attendees.find(a => a.memberId === id);
  function setAvailability(eid, id, value) {
    commit(() => {
      const e = state.events.find(x => x.id === eid), a = attendee(e, id);
      if (!a) throw new Error('Cet enfant n’est pas convoqué.');
      if (value === 'absent' && e.offers.some(c => c.onboard.includes(id) && Object.values(c.legs).some(l => l.enabled))) throw new Error('Cet enfant est dans une voiture : modifiez d’abord la voiture.');
      a.availability = value;
      if (value === 'absent') a.transport = { outbound: 'unknown', return: 'unknown' };
      else for (const l of ['outbound', 'return']) if (a.transport[l] === 'unknown') a.transport[l] = 'need';
      stamp(a);
    });
  }
  function setTransport(eid, id, leg, value) {
    commit(() => {
      const e = state.events.find(x => x.id === eid), a = attendee(e, id);
      if (!a) throw new Error('Cet enfant n’est pas convoqué.');
      if (D.pooled(e, leg).onboard.has(id)) throw new Error('Cet enfant est dans une voiture : modifiez la voiture pour le retirer.');
      if (value === 'confirmed' && a.transport[leg] !== 'confirmed' && D.pooled(e, leg).free < 1) throw new Error('Il n’y a plus de place. Demandez à un parent d’en proposer.');
      if (a.availability !== 'present') a.availability = 'present';
      a.transport[leg] = value;
      stamp(a);
    });
  }
  function stamp(a) { a.answeredBy = store.name || 'Un parent'; a.answeredAt = new Date().toISOString(); }

  function toggleMission(eid, mid) {
    if (!store.name) { askName(() => toggleMission(eid, mid)); return; }
    commit(() => {
      const m = state.events.find(x => x.id === eid).missions.find(x => x.id === mid), n = store.name;
      m.assigned = m.assigned.includes(n) ? m.assigned.filter(x => x !== n) : [...m.assigned, n];
    });
  }

  function saveOffer(eid, form) {
    const data = new FormData(form), id = data.get('id');
    const driver = String(data.get('driver') || '').trim();
    if (!driver) throw new Error('Indiquez le prénom du conducteur.');
    store.name = store.name || driver; remember();
    const onboard = data.getAll('onboard'), legs = {};
    for (const [l] of LEGS) {
      const on = data.has(l + 'On'), offered = on ? Math.max(0, Math.min(8, Number(data.get(l + 'Free') || 0))) : 0;
      legs[l] = { enabled: on, offered, reserved: 0 };
    }
    if (!legs.outbound.enabled && !legs.return.enabled) throw new Error('Choisissez l’aller, le retour, ou les deux.');
    const spare = Math.max(legs.outbound.offered, legs.return.offered);
    const totalSeats = Math.max(2, 1 + onboard.length + spare);
    if (totalSeats > 9) throw new Error('Une voiture ne dépasse pas 9 places.');
    return commit(() => {
      const e = state.events.find(x => x.id === eid), old = e.offers.find(c => c.id === id);
      const car = { ...old, id: old?.id || C.id('car'), driver, parentOf: String(data.get('parentOf') || '').trim(), ownerUserId: 'link', totalSeats, onboard, backup: false, legs };
      C.checkOffer(car);
      for (const [l] of LEGS) {
        for (const kid of old?.onboard || []) {
          if (old.legs[l].enabled && (!legs[l].enabled || !onboard.includes(kid)) && !e.offers.some(x => x.id !== old.id && x.legs[l].enabled && x.onboard.includes(kid))) { const a = attendee(e, kid); if (a) a.transport[l] = 'need'; }
        }
        if (legs[l].enabled) for (const kid of onboard) {
          const a = attendee(e, kid);
          if (!a || !a.selected) throw new Error('Cet enfant n’est pas convoqué à ce rendez-vous.');
          a.availability = 'present'; a.transport[l] = 'parent';
        }
      }
      if (old) Object.assign(old, car); else e.offers.push(car);
    });
  }
  function removeOffer(eid, cid) {
    commit(() => {
      const e = state.events.find(x => x.id === eid), old = e.offers.find(c => c.id === cid);
      if (!old) return;
      for (const [l] of LEGS) for (const kid of old.onboard) if (old.legs[l].enabled && !e.offers.some(x => x.id !== cid && x.legs[l].enabled && x.onboard.includes(kid))) { const a = attendee(e, kid); if (a) a.transport[l] = 'need'; }
      e.offers = e.offers.filter(c => c.id !== cid);
      // les places réservées au-delà de la capacité repassent en recherche
      for (const [l] of LEGS) { let guard = 40; while (D.pooled(e, l).free < 0 && guard--) { const a = C.activeAttendees(e).reverse().find(x => x.transport[l] === 'confirmed' && !D.pooled(e, l).onboard.has(x.memberId)); if (!a) break; a.transport[l] = 'need'; } }
    });
  }

  /* ---------- affichage ---------- */
  function seats(e, leg, label) {
    const kids = C.activeAttendees(e).filter(a => member(a.memberId)?.kind === 'child');
    const placed = kids.filter(a => ['confirmed', 'parent'].includes(a.transport[leg]));
    const waiting = kids.filter(a => !['confirmed', 'parent'].includes(a.transport[leg]));
    const free = Math.max(0, D.pooled(e, leg).free);
    const square = (cls, n) => Array.from({ length: n }, () => `<span class="sq ${cls}" aria-hidden="true"></span>`).join('');
    const names = waiting.map(a => E(first(a.memberId))).join(', ');
    const ok = !waiting.length && kids.length > 0;
    return `<div class="seat-row"><div class="seat-head"><strong>${label}</strong><span class="verdict ${ok ? 'ok' : kids.length ? 'bad' : ''}">${kids.length ? (ok ? 'Tous les enfants ont une place' : `${waiting.length} sans place : ${names}`) : 'Aucun enfant'}</span></div>
      <div class="squares" role="img" aria-label="${placed.length} enfants placés, ${waiting.length} sans place, ${free} places libres">${square('full', placed.length)}${square('need', waiting.length)}${square('free', free)}</div>
      <p class="muted">${placed.length} sur ${kids.length} enfants ont une place · ${free} place${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''}</p></div>`;
  }

  function kidBlock(e, a) {
    const id = a.memberId, absent = a.availability === 'absent', pooled = LEGS.map(([l]) => D.pooled(e, l));
    const legs = LEGS.map(([l, label], i) => {
      const car = e.offers.find(c => c.legs[l].enabled && c.onboard.includes(id));
      if (car) return `<div class="leg"><strong>${label}</strong><p class="status ok">Dans la voiture de ${E(car.driver)}</p></div>`;
      const cur = a.transport[l], p = pooled[i];
      const btn = (v, text, disabled = false) => `<button data-f="tr" data-e="${E(e.id)}" data-m="${E(id)}" data-l="${l}" data-v="${v}" aria-pressed="${cur === v}" ${disabled ? 'disabled' : ''}>${text}</button>`;
      return `<div class="leg"><strong>${label}</strong><div class="seg3">${btn('need', 'Cherche une place')}${btn('confirmed', 'Place trouvée', cur !== 'confirmed' && p.free < 1)}${btn('parent', 'Avec ses parents')}</div></div>`;
    }).join('');
    return `<article class="kid"><div class="kid-head"><h3>${E(first(id))}</h3><div class="seg2"><button data-f="av" data-e="${E(e.id)}" data-m="${E(id)}" data-v="present" aria-pressed="${a.availability === 'present'}">Présent</button><button data-f="av" data-e="${E(e.id)}" data-m="${E(id)}" data-v="absent" aria-pressed="${absent}">Absent</button></div></div>${absent ? '<p class="muted">Pas de transport nécessaire.</p>' : legs}${a.answeredBy && a.answeredAt ? `<p class="muted tiny">Dernière réponse : ${E(a.answeredBy)}, ${E(new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(a.answeredAt)))}</p>` : ''}</article>`;
  }

  function cars(e) {
    const rows = e.offers.map(c => {
      const o = c.legs.outbound.enabled ? `aller : ${c.legs.outbound.offered} libre${c.legs.outbound.offered > 1 ? 's' : ''}` : '', r = c.legs.return.enabled ? `retour : ${c.legs.return.offered} libre${c.legs.return.offered > 1 ? 's' : ''}` : '';
      return `<li><div><strong>Voiture de ${E(c.driver)}</strong>${c.parentOf ? ` <span class="muted">parent de ${E(c.parentOf)}</span>` : ''}<br><span class="muted">${[o, r].filter(Boolean).join(' · ')}${c.onboard.length ? ` · avec ${E(c.onboard.map(first).join(', '))}` : ''}</span></div><div class="row"><button data-f="car" data-e="${E(e.id)}" data-c="${E(c.id)}">Modifier</button><button data-f="car-del" data-e="${E(e.id)}" data-c="${E(c.id)}">Retirer</button></div></li>`;
    }).join('');
    return `<div class="cars">${rows ? `<ul class="car-list">${rows}</ul>` : '<p class="muted">Aucune voiture proposée pour l’instant.</p>'}<button class="primary" data-f="car" data-e="${E(e.id)}">Je propose des places en voiture</button></div>`;
  }

  function helpers(e) {
    const free = e.missions.filter(m => m.assigned.length < m.needed).length;
    return `<details class="help" data-e="${E(e.id)}" ${openHelp.has(e.id) ? 'open' : ''}><summary>Coups de main${free ? ` · ${free} à pourvoir` : ''}</summary><ul class="mission-list">${e.missions.map(m => { const has = m.assigned.includes(store.name); return `<li><div><strong>${E(m.name)}</strong><br><span class="muted">${m.assigned.length ? E(m.assigned.join(', ')) : 'Personne pour l’instant'}${m.needed > 1 ? ` · ${m.assigned.length}/${m.needed}` : ''}</span></div><button data-f="mission" data-e="${E(e.id)}" data-mid="${E(m.id)}" ${!has && m.assigned.length >= m.needed ? 'disabled' : ''}>${has ? 'Je retire' : 'Je prends'}</button></li>`; }).join('')}</ul></details>`;
  }

  function mapLink(address) { return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : ''; }

  function eventCard(e) {
    const kids = myAttendees(e), meet = e.meetingTime ? `Rendez-vous à ${E(e.meetingTime)}${e.meetingAddress ? ' · ' + E(e.meetingAddress) : ''}` : '', place = e.address ? E(e.address) : '';
    const answered = kids.every(a => a.availability !== 'unknown' && a.transport.outbound !== 'unknown' && a.transport.return !== 'unknown');
    return `<section class="card f-event"><p class="eyebrow">${E(day(e.date))}${e.time ? ' · ' + E(e.time) : ''}</p><h2>${E(e.title)}</h2>
      <p class="where">${meet ? meet + '<br>' : ''}${place ? place + (mapLink(e.address) ? ` <a href="${mapLink(e.address)}" target="_blank" rel="noopener">Itinéraire</a>` : '') : ''}</p>
      ${e.notes ? `<p class="muted">${E(e.notes)}</p>` : ''}
      ${kids.map(a => kidBlock(e, a)).join('')}
      <div class="seats"><h3>Places en voiture</h3>${LEGS.map(([l, label]) => seats(e, l, label)).join('')}</div>
      <div class="cars-box"><h3>Voitures</h3>${cars(e)}</div>${helpers(e)}</section>`;
  }

  function demoBanner() { return DEMO ? '<p class="notice demo-notice">Démonstration : personnes et rendez-vous fictifs. Rien n’est envoyé au club. <button data-f="demo-reset">Recommencer</button></p>' : ''; }
  function header() {
    const ids = mine();
    return `<div class="f-head"><div><p class="eyebrow">${E(clubName)}</p><h1>${ids.length ? 'Pour ' + E(ids.map(first).join(' et ')) : 'Bienvenue'}</h1></div><button data-f="who">${ids.length ? 'Changer d’enfant' : 'Choisir mon enfant'}</button></div>`;
  }

  function home() {
    const list = myEvents();
    return `${demoBanner()}${header()}${list.length ? list.map(eventCard).join('') : '<section class="card"><h2>Rien de prévu pour le moment</h2><p>Les prochains rendez-vous de votre enfant apparaîtront ici dès que le coach les aura convoqués. Gardez ce lien : vous pourrez le rouvrir quand vous voulez.</p></section>'}`;
  }

  function who() {
    const q = search.trim().toLocaleLowerCase('fr'), kids = state.members.filter(m => m.kind === 'child' && (!q || m.name.toLocaleLowerCase('fr').includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const chosen = pickDraft;
    return `<div class="f-head"><div><p class="eyebrow">${E(clubName)}</p><h1>Qui est votre enfant ?</h1></div></div>
      <section class="card"><label><span>Votre prénom <small>(pour les voitures et les coups de main)</small></span><input id="f-name" maxlength="40" autocomplete="given-name" value="${E(store.name)}"></label>
      <label><span>Chercher un prénom</span><input id="f-search" type="search" value="${E(search)}" autocomplete="off"></label>
      <div class="group-pick kids">${kids.map(m => `<label class="check"><input type="checkbox" data-f="pick" value="${E(m.id)}" ${chosen.includes(m.id) ? 'checked' : ''}><span>${E(m.name)}</span></label>`).join('') || '<p class="muted">Aucun résultat.</p>'}</div>
      <p><button data-f="add-child">Mon enfant n’est pas dans la liste</button></p>
      <div class="actions"><button class="primary" data-f="who-done" ${chosen.length ? '' : 'disabled'}>Continuer</button>${mine().length ? '<button data-f="who-cancel">Annuler</button>' : ''}</div></section>`;
  }

  function render() {
    const app = $('#app'); if (!app) return;
    if (screen === 'loading') { app.innerHTML = '<div class="empty" role="status">Chargement…</div>'; return; }
    if (screen === 'error') { app.innerHTML = `<section class="card"><h2>Ce lien ne fonctionne pas</h2><p>${E(error)}</p><button class="primary" data-f="retry">Réessayer</button></section>`; return; }
    const open = document.activeElement?.id;
    app.innerHTML = screen === 'who' ? who() : home();
    if (open === 'f-search') { const el = $('#f-search'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }

  /* ---------- fenêtres ---------- */
  function dialog(title, body, formName) {
    const box = $('#editor'); if (!box) return;
    $('#dialog-content').innerHTML = `<div class="dialog-head"><h2>${E(title)}</h2><button data-f="close" aria-label="Fermer">✕</button></div><div class="dialog-body"><form data-f-form="${formName}"><p id="form-error" class="error" role="alert" hidden></p>${body}</form></div>`;
    if (!box.open) box.showModal();
  }
  const closeDialog = () => { const box = $('#editor'); if (box?.open) box.close(); dialogEvent = null; };
  const formError = e => { const box = $('#form-error'); if (box) { box.hidden = false; box.textContent = e.message || String(e); } else say(e.message); };

  function askName(then) {
    dialog('Votre prénom', `<label><span>Comment vous appelle-t-on ?</span><input name="name" required maxlength="40" autocomplete="given-name"></label><div class="actions"><button class="primary" type="submit">Continuer</button></div>`, 'name');
    askName.then = then;
  }

  function carDialog(eid, cid) {
    const e = state.events.find(x => x.id === eid), old = e.offers.find(c => c.id === cid);
    dialogEvent = eid;
    const kids = myAttendees(e), onboard = old?.onboard || [];
    const leg = (l, label) => { const c = old?.legs[l]; return `<div class="leg-form"><label class="check"><input type="checkbox" name="${l}On" ${(c?.enabled ?? true) ? 'checked' : ''}><span>${label}</span></label><label><span>Places libres pour d’autres enfants</span><input name="${l}Free" type="number" min="0" max="8" inputmode="numeric" value="${c ? c.offered : 2}"></label></div>`; };
    dialog(old ? 'Ma voiture' : 'Je propose des places', `<input type="hidden" name="id" value="${E(old?.id || '')}">
      <label><span>Conducteur (prénom)</span><input name="driver" required maxlength="40" value="${E(old?.driver || store.name)}"></label>
      <label><span>Parent de</span><input name="parentOf" maxlength="60" value="${E(old?.parentOf ?? kids.map(a => first(a.memberId)).join(' et '))}"></label>
      ${kids.length ? `<div class="group-pick"><p class="muted" style="width:100%">Mon enfant est dans la voiture</p>${kids.map(a => `<label class="check"><input type="checkbox" name="onboard" value="${E(a.memberId)}" ${onboard.includes(a.memberId) ? 'checked' : ''}><span>${E(first(a.memberId))}</span></label>`).join('')}</div>` : ''}
      ${leg('outbound', 'Je conduis à l’aller')}${leg('return', 'Je conduis au retour')}
      <div class="actions"><button class="primary" type="submit">Enregistrer</button><button type="button" data-f="close">Annuler</button></div>`, 'car');
  }

  function addChildDialog() {
    const groups = state.groups;
    dialog('Ajouter mon enfant', `<label><span>Prénom</span><input name="first" required maxlength="40" autocomplete="off"></label>
      <label><span>Initiale du nom <small>(seulement si un autre enfant a le même prénom)</small></span><input name="initial" maxlength="1" autocomplete="off" style="max-width:5rem"></label>
      <div class="group-pick"><p class="muted" style="width:100%">Son groupe</p>${groups.map(g => `<label class="check"><input type="radio" name="group" value="${E(g.id)}"><span>${E(g.parentId ? (state.groups.find(x => x.id === g.parentId)?.name || '') + ' / ' : '')}${E(g.name)}</span></label>`).join('')}</div>
      <div class="actions"><button class="primary" type="submit">Ajouter</button><button type="button" data-f="close">Annuler</button></div>`, 'child');
  }

  /* ---------- événements ---------- */
  document.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-f]'); if (!b || b.disabled) return;
    const a = b.dataset.f, d = b.dataset;
    if (a === 'av') setAvailability(d.e, d.m, d.v);
    else if (a === 'tr') setTransport(d.e, d.m, d.l, d.v);
    else if (a === 'mission') toggleMission(d.e, d.mid);
    else if (a === 'car') carDialog(d.e, d.c);
    else if (a === 'car-del') { if (confirm('Retirer cette voiture ?')) removeOffer(d.e, d.c); }
    else if (a === 'who') { pickDraft = [...mine()]; search = ''; screen = 'who'; render(); }
    else if (a === 'who-cancel') { screen = 'home'; render(); }
    else if (a === 'who-done') {
      store.mine = [...pickDraft]; store.name = ($('#f-name')?.value || store.name || '').trim(); remember(); screen = 'home'; render();
    }
    else if (a === 'add-child') addChildDialog();
    else if (a === 'close') closeDialog();
    else if (a === 'retry') boot();
    else if (a === 'demo-reset') { localStorage.removeItem(demoKey); localStorage.removeItem(storeKey); location.reload(); }
  });
  document.addEventListener('toggle', ev => { const d = ev.target; if (d.classList?.contains('help')) { if (d.open) openHelp.add(d.dataset.e); else openHelp.delete(d.dataset.e); } }, true);
  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.f === 'pick') { pickDraft = el.checked ? [...new Set([...pickDraft, el.value])] : pickDraft.filter(x => x !== el.value); const go = document.querySelector('[data-f="who-done"]'); if (go) go.disabled = !pickDraft.length; }
  });
  document.addEventListener('input', ev => {
    if (ev.target.id === 'f-search') { search = ev.target.value; const name = $('#f-name')?.value; if (name !== undefined) store.name = name; render(); }
    if (ev.target.id === 'f-name') store.name = ev.target.value;
  });
  document.addEventListener('submit', async ev => {
    const form = ev.target.closest('form[data-f-form]'); if (!form) return;
    ev.preventDefault();
    const type = form.dataset.fForm;
    try {
      if (type === 'name') { store.name = String(new FormData(form).get('name')).trim(); if (!store.name) throw new Error('Indiquez votre prénom.'); remember(); closeDialog(); const then = askName.then; askName.then = null; if (then) then(); render(); }
      if (type === 'car') { if (saveOffer(dialogEvent, form)) closeDialog(); }
      if (type === 'child') {
        const data = new FormData(form), firstName = String(data.get('first') || '').trim(), initial = String(data.get('initial') || '').trim().slice(0, 1).toLocaleUpperCase('fr');
        if (!firstName) throw new Error('Indiquez le prénom.');
        const group = data.get('group'); if (!group) throw new Error('Choisissez son groupe.');
        const dup = state.members.some(m => m.name.split(' ')[0].toLocaleLowerCase('fr') === firstName.toLocaleLowerCase('fr'));
        if (dup && !initial) throw new Error('Un enfant s’appelle déjà ' + firstName + ' : ajoutez l’initiale du nom.');
        const name = initial ? `${firstName} ${initial}.` : firstName;
        const result = await rpc('lumo_link_add_child', { p_token: token, p_name: name, p_group_ids: [group] });
        apply(result);
        const added = state.members.find(m => m.name === name);
        if (added) { pickDraft = [...new Set([...pickDraft, added.id])]; if (screen !== 'who') { store.mine = [...new Set([...store.mine, added.id])]; remember(); } }
        closeDialog(); render(); say(name + ' est ajouté.');
      }
    } catch (e) { formError(e); }
  });

  /* ---------- démarrage ---------- */
  async function boot() {
    screen = 'loading'; render();
    try { await pull(); screen = mine().length ? 'home' : 'who'; pickDraft = [...mine()]; }
    catch (e) { screen = 'error'; error = e.offline ? 'Pas de connexion. Vérifiez internet puis réessayez.' : e.message; }
    indicator(); render();
  }
  setInterval(async () => {
    if (document.hidden || dirty || saving || !state || screen !== 'home' || $('#editor')?.open) return;
    try { const r = await rpc('lumo_link_open', { p_token: token }); if (r.club.revision !== revision) { apply(r); render(); } } catch { /* silencieux */ }
  }, 12000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dirty) flush(); });
  window.addEventListener('online', () => { if (dirty) flush(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
