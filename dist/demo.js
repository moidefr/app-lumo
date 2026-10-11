/* All names, fixtures, schedules and assignments below are fictional. */
(function (root) {
  'use strict';
  const C=typeof module==='object'&&module.exports?require('./core.js'):root.HandCore;
  C.seedFullDemo=function(referenceDate=new Date()) {
    const start=new Date(C.dayString(referenceDate)+'T12:00:00Z');
    const dateAt=offset=>{const date=new Date(start);date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);};
    const state={version:1,demoRevision:2,clubName:'Handball Club Crest Pays de Saillans',groups:[
      {id:'g13',name:'−13 filles',parentId:null},{id:'g13m',name:'−13 garçons',parentId:null},
      {id:'g15',name:'−15 garçons',parentId:null},{id:'g18',name:'−18 garçons',parentId:null},
      {id:'gsf',name:'Seniors féminines',parentId:null},{id:'gsm',name:'Seniors masculins',parentId:null},
      {id:'gloisir',name:'Hand loisir',parentId:null},
      {id:'ggervanne',name:'Secteur Gervanne',parentId:'g13'},
      {id:'gcrest',name:'Secteur Crest',parentId:'g13'},
      {id:'gsaillans',name:'Secteur Saillans',parentId:'g15'},
      {id:'gvallee',name:'Vallée de la Drôme',parentId:'g18'}
    ],members:[],events:[],notifications:[]};
    const add=(id,name,kind,parentName,groups)=>state.members.push({id,name,kind,parentName,groups});
    [
      ['lea','Léa Martin','Sophie Martin',['g13','ggervanne']],
      ['ines','Inès Durand','Karim Durand',['g13','gcrest']],
      ['emma','Emma Robert','Julie Robert',['g13','gcrest']],
      ['chloe','Chloé Bernard','Camille Bernard',['g13','ggervanne']],
      ['lou','Lou Morel','Thomas Morel',['g13','ggervanne']],
      ['manon','Manon Roux','Claire Roux',['g13','gcrest']],
      ['jade','Jade Perrin','Nicolas Perrin',['g13']],
      ['alice','Alice Faure','Élodie Faure',['g13']],
      ['hugo','Hugo Martin','Sophie Martin',['g15','gsaillans']],
      ['adam','Adam Petit','Marie Petit',['g15','gsaillans']],
      ['noah','Noah Bernard','Camille Bernard',['g15']],
      ['louis','Louis Morel','Thomas Morel',['g15']],
      ['sacha','Sacha Roux','Claire Roux',['g15','gsaillans']],
      ['nathan','Nathan Perrin','Nicolas Perrin',['g15']],
      ['tom','Tom Faure','Élodie Faure',['g15']],
      ['enzo','Enzo Leroy','Paul Leroy',['g15']],
      ['gabriel','Gabriel Brun','Lucie Brun',['g13m']],
      ['arthur','Arthur Garcia','David Garcia',['g13m']],
      ['raphael','Raphaël Blanc','Anaïs Blanc',['g13m']],
      ['malo','Malo Chevalier','Julien Chevalier',['g13m']],
      ['ethan','Ethan Lambert','Isabelle Lambert',['g18','gvallee']],
      ['axel','Axel Bonnet','Marc Bonnet',['g18','gvallee']],
      ['leo','Léo Fournier','Sarah Fournier',['g18']],
      ['maxime','Maxime Girard','Benoît Girard',['g18']],
      ['baptiste','Baptiste André','Céline André',['g18']],
      ['theo','Théo Mercier','Olivier Mercier',['g18']]
    ].forEach(([id,name,parent,groups])=>add(id,name,'child',parent,groups));
    [
      ['sophie','Sophie Martin','Maman de Léa et Hugo',['g13','g15']],
      ['karim','Karim Durand','Papa d’Inès · accompagnateur',['g13']],
      ['marie','Marie Petit','Maman d’Adam · bénévole',['g15','gloisir']],
      ['camille','Camille Bernard','Parent de Chloé et Noah',['g13','g15']],
      ['thomas','Thomas Morel','Papa de Lou et Louis',['g13','g15']],
      ['julie','Julie Robert','Maman d’Emma',['g13']],
      ['claire','Claire Roux','Maman de Manon et Sacha',['g13','g15']],
      ['elodie','Élodie Faure','Maman d’Alice et Tom · table de marque',['g13','g15']],
      ['coach-13','Nora Vidal','Coach −13 filles · personnage fictif',['g13']],
      ['coach-15','Yann Marchand','Coach −15 garçons · personnage fictif',['g15']],
      ['coach-18','Alex Dumont','Coach −18 · personnage fictif',['g18']],
      ['arbiter','Lucas Laurent','Juge-arbitre · personnage fictif',['g18','gsm']],
      ['lucie','Lucie Brun','Maman de Gabriel · hand loisir',['g13m','gloisir']],
      ['sarah','Sarah Fournier','Maman de Léo · accompagnatrice',['g18','gloisir']],
      ['sf-1','Pauline Nicolas','Joueuse senior · personnage fictif',['gsf']],
      ['sf-2','Mélanie Garnier','Joueuse senior · personnage fictif',['gsf']],
      ['sf-3','Amandine Roussel','Joueuse senior · personnage fictif',['gsf']],
      ['sf-4','Laura Mathieu','Joueuse senior · personnage fictif',['gsf']],
      ['sm-1','Romain Masson','Joueur senior · personnage fictif',['gsm']],
      ['sm-2','Antoine Colin','Joueur senior · personnage fictif',['gsm']],
      ['sm-3','Jules Lefèvre','Joueur senior · personnage fictif',['gsm']],
      ['loisir-1','Valérie Renault','Hand loisir · personnage fictif',['gloisir']],
      ['loisir-2','Philippe Aubert','Hand loisir · personnage fictif',['gloisir']]
    ].forEach(([id,name,parent,groups])=>add(id,name,'adult',parent,groups));
    const attendee=(memberId,outbound='unknown',back='unknown',availability='present',team='Équipe A',selected=true)=>({memberId,availability,selected,team,transport:{outbound,return:back}});
    const car=(id,driver,parentOf,totalSeats,onboard,out,back)=>({id,driver,parentOf,totalSeats,onboard,legs:{outbound:{enabled:out!==null,offered:out?.[0]||0,reserved:out?.[1]||0},return:{enabled:back!==null,offered:back?.[0]||0,reserved:back?.[1]||0}}});
    const mission=(id,name,needed,assigned=[])=>({id,name,needed,assigned});
    const activity=(id,title,type,groups,offset,time,attendees,offers=[],missions=[],extra={})=>{
      const event={id,title,type,groups,date:dateAt(offset),time,meetingTime:'',meetingAddress:'Parking de démonstration · gymnase de Crest',address:'Gymnase de démonstration · Crest',notes:'DÉMONSTRATION : personnes, rencontres, horaires et lieux fictifs.',cancelled:false,source:null,rosterPublished:false,attendees,offers,missions,...extra};
      state.events.push(event);return event;
    };
    activity('match-demo','−13 filles · déplacement à Valence (démo)','match',['g13'],6,'15:00',[
      attendee('lea','parent','parent'),attendee('ines','confirmed','need'),attendee('emma','confirmed','confirmed'),
      attendee('chloe','parent','confirmed'),attendee('lou','confirmed','need'),attendee('manon','need','need'),
      attendee('jade','unknown','unknown','unknown'),attendee('alice','unknown','unknown','absent'),
      attendee('karim','confirmed','need','present','Accompagnateur')
    ],[
      car('car-sophie','Sophie Martin','Léa et Hugo',5,['lea'],[3,2],[3,1]),
      car('car-camille','Camille Bernard','Chloé et Noah',7,['chloe'],[4,1],null)
    ],[
      mission('match1-coach','Accompagner le coach',2,['Karim Durand']),mission('match1-shirts','Apporter les maillots',1,['Sophie Martin']),
      mission('match1-wash','Laver les maillots',1),mission('match1-cakes','Préparer les gâteaux',2,['Julie Robert']),
      mission('match1-arbiter','Arbitrer',1,['Lucas Laurent'])
    ],{meetingTime:'13:15',meetingAddress:'Parking du gymnase · Crest (démo)',address:'Gymnase de démonstration · Valence',rosterPublished:true,demoScenario:'Aller presque organisé ; plusieurs retours manquants ; un enfant sans réponse.'});
    activity('match-15-complet','−15 garçons · déplacement entièrement organisé (démo)','match',['g15'],7,'14:00',[
      attendee('hugo','parent','parent'),attendee('adam','parent','parent'),attendee('noah','confirmed','confirmed'),
      attendee('louis','confirmed','confirmed'),attendee('sacha','confirmed','confirmed'),attendee('nathan','confirmed','confirmed'),
      attendee('tom','parent','parent'),attendee('enzo','unknown','unknown','absent'),attendee('coach-15','confirmed','confirmed','present','Coach')
    ],[
      car('car15-sophie','Sophie Martin','Hugo et Léa',5,['hugo'],[3,3],[3,3]),
      car('car15-marie','Marie Petit','Adam',7,['adam'],[5,1],[5,1]),
      car('car15-elodie','Élodie Faure','Tom et Alice',5,['tom'],[2,0],[2,0])
    ],[mission('m15-coach','Accompagner le coach',1,['Marie Petit']),mission('m15-shirts','Apporter les maillots',1,['Élodie Faure']),mission('m15-wash','Laver les maillots',1,['Sophie Martin'])],{meetingTime:'12:20',address:'Gymnase de démonstration · Romans',rosterPublished:true,demoScenario:'Tous les enfants présents ont un transport aller et retour ; une voiture est pleine.'});
    activity('match-13-domicile','−13 garçons · match à domicile (démo)','match',['g13m'],6,'11:00',[
      attendee('gabriel','parent','parent'),attendee('arthur','parent','parent'),attendee('raphael','need','parent'),attendee('malo','unknown','unknown','unknown')
    ],[],[
      mission('home-ref','Juge-arbitre',1,['Lucas Laurent']),mission('home-table','Table de marque',2,['Élodie Faure']),
      mission('home-room','Responsable de salle',1,['Thomas Morel']),mission('home-bar','Buvette · 10 h–12 h',2),
      mission('home-snack','Gérer le goûter',1,['Lucie Brun']),mission('home-cakes','Gâteaux',3,['Camille Bernard','Julie Robert'])
    ],{meetingTime:'10:15',demoScenario:'Familles autonomes ; organisation de salle, table, arbitrage et goûter à compléter.'});
    activity('tournament-intergroups','Tournoi commun −13 / −15 (démo)','match',['g13','g15'],20,'09:30',[
      attendee('lea','parent','parent','present','−13 filles'),attendee('ines','confirmed','confirmed','present','−13 filles'),
      attendee('emma','confirmed','need','present','−13 filles'),attendee('chloe','parent','parent','present','−13 filles'),
      attendee('lou','confirmed','confirmed','present','−13 filles'),attendee('manon','need','confirmed','present','−13 filles'),
      attendee('hugo','parent','parent','present','−15 garçons'),attendee('adam','confirmed','need','present','−15 garçons'),
      attendee('noah','parent','parent','present','−15 garçons'),attendee('louis','confirmed','confirmed','present','−15 garçons'),
      attendee('sacha','need','unknown','unknown','−15 garçons'),attendee('nathan','unknown','unknown','present','Réserve',false),
      attendee('karim','confirmed','confirmed','present','Accompagnateur'),attendee('sarah','need','need','present','Accompagnatrice')
    ],[
      car('tour-sophie','Sophie Martin','Léa et Hugo',5,['lea','hugo'],[2,1],[2,1]),
      car('tour-camille','Camille Bernard','Chloé et Noah',7,['chloe','noah'],[4,2],[4,1]),
      car('tour-thomas','Thomas Morel','Lou et Louis',9,['lou','louis'],[6,2],[6,3])
    ],[mission('tour-coach','Parents licenciés accompagnateurs',3,['Karim Durand']),mission('tour-shirts','Prendre les maillots',2,['Sophie Martin','Thomas Morel']),mission('tour-food','Prévoir le pique-nique collectif',2,['Claire Roux'])],{meetingTime:'07:45',address:'Complexe sportif de démonstration · Montélimar',rosterPublished:true,demoScenario:'Deux groupes partagent trois voitures, dont un véhicule neuf places ; équipes distinctes et réserve.'});
    const trainingIds=['lea','ines','emma','chloe','lou','manon','jade','alice'];
    for(let week=0;week<4;week++)activity('training-'+week,'Entraînement −13 filles · semaine '+(week+1)+' (démo)','training',['g13'],3+7*week,'17:30',trainingIds.map((id,index)=>week===0?attendee(id,index<3?'confirmed':index<5?'parent':'need',index<2?'confirmed':'need',id==='jade'?'unknown':'present','Entraînement'):attendee(id,'unknown','unknown','unknown','Entraînement')),
      week===0?[car('train-karim','Karim Durand','Inès',5,['ines'],[3,2],null),car('train-claire','Claire Roux','Manon et Sacha',7,['manon'],null,[4,1])]:[],
      [mission('train-'+week+'-coach','Aider à l’entraînement',1,week===0?['Sophie Martin']:[])],
      {seriesId:'series-training13',meetingTime:'17:15',demoScenario:week===0?'Covoiturage régulier : un conducteur à l’aller, un autre au retour.':'Occurrence hebdomadaire indépendante : réponses et voitures encore à renseigner.'});
    const seniorF=['sf-1','sf-2','sf-3','sf-4'];
    activity('seniors-f','Seniors féminines · déplacement (démo)','match',['gsf'],13,'18:00',seniorF.map((id,index)=>attendee(id,index<3?'confirmed':'need',index<2?'confirmed':'need','present','Seniors féminines')),
      [car('senior-car','Pauline Nicolas','',5,[],[4,2],[4,1])],
      [mission('sf-shirts','Prendre les maillots',1,['Laura Mathieu']),mission('sf-wash','Laver les maillots',1)],
      {meetingTime:'16:15',address:'Gymnase de démonstration · Die',demoScenario:'Des adultes sans véhicule demandent des places ; aucun enfant dans ce groupe.'});
    activity('club-evening','Soirée du club et bénévoles (démo)','special',['gloisir','gsf','gsm'],12,'19:00',[
      attendee('marie','confirmed','need','present','Bénévole'),attendee('lucie','confirmed','confirmed','present','Bénévole'),
      attendee('sarah','unknown','unknown','unknown','Bénévole'),attendee('loisir-1','confirmed','confirmed','present','Hand loisir'),
      attendee('loisir-2','need','need','present','Hand loisir'),attendee('sm-1','confirmed','confirmed','present','Senior'),attendee('sf-2','need','confirmed','present','Senior')
    ],[car('evening-lucie','Lucie Brun','Gabriel',5,[],[4,2],[4,2])],
    [mission('evening-bar1','Buvette · 19 h–20 h 30',2,['Marie Petit']),mission('evening-bar2','Buvette · 20 h 30–22 h',2),
      mission('evening-cakes','Apporter un gâteau',4,['Lucie Brun','Pauline Nicolas']),mission('evening-room','Installation de la salle',3,['Romain Masson','Philippe Aubert']),mission('evening-clean','Rangement après la soirée',3)],
    {address:'Salle de démonstration · Saillans',demoScenario:'Événement ponctuel pour adultes, plusieurs groupes, buvette par créneaux et bénévoles.'});
    activity('match-18-cancelled','−18 garçons · match annulé (démo)','match',['g18'],14,'16:00',[
      attendee('ethan','unknown','unknown'),attendee('axel','unknown','unknown'),attendee('leo','unknown','unknown'),attendee('maxime','unknown','unknown')
    ],[],[],{cancelled:true,demoScenario:'Un match annulé reste visible dans le calendrier.'});
    activity('match-import-example','−18 garçons · exemple de match importé (démo)','match',['g18'],27,'16:30',[
      attendee('ethan','parent','parent'),attendee('axel','need','need'),attendee('leo','unknown','unknown','unknown'),
      attendee('maxime','unknown','unknown','present','Équipe B',false),attendee('baptiste','need','confirmed'),attendee('theo','confirmed','confirmed'),
      attendee('coach-18','confirmed','confirmed','present','Coach')
    ],[car('18-isabelle','Isabelle Lambert','Ethan',5,['ethan'],[3,1],[3,2])],
    [mission('18-ref','Arbitre · à désigner',1),mission('18-table','Table de marque',2,['Sarah Fournier'])],
    {meetingTime:'14:50',address:'Gymnase de démonstration · Guilherand-Granges',source:{key:'demo:import-example',url:'',uid:'demo-import-example',syncedAt:new Date(referenceDate).toISOString()},demoScenario:'Exemple fictif de provenance calendrier ; disponibilités, réserve et arbitre encore à choisir.'});
    const note=(id,title,body,eventId,read,minutesAgo)=>state.notifications.push({id,title,body,eventId,read,createdAt:new Date(new Date(referenceDate).getTime()-minutesAgo*60000).toISOString()});
    note('demo-note-1','Démo · transport retour à compléter','−13 filles : Inès, Lou et Manon cherchent encore un retour.','match-demo',false,8);
    note('demo-note-2','Démo · convocation publiée','−15 garçons : sept joueurs disponibles, Enzo absent.','match-15-complet',false,25);
    note('demo-note-3','Démo · bénévoles recherchés','Il manque une personne à la table de marque et deux à la buvette.','match-13-domicile',false,55);
    note('demo-note-4','Démo · tournoi intergroupes','Les −13 et les −15 partagent le déplacement. Rendez-vous à 7 h 45.','tournament-intergroups',false,90);
    note('demo-note-5','Démo · match annulé','La rencontre −18 reste visible avec son statut annulé.','match-18-cancelled',true,150);
    note('demo-note-6','Démo · maillots attribués','Élodie apporte les maillots des −15 ; Sophie les lave.','match-15-complet',true,210);
    for(const event of state.events)for(const offer of event.offers)for(const journey of ['outbound','return'])if(offer.legs[journey].enabled)for(const memberId of offer.onboard){
      const attendee=event.attendees.find(item=>item.memberId===memberId);if(attendee)attendee.transport[journey]='parent';
    }
    return C.validateState(state);
  };
})(globalThis);
