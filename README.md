# HandClub — bêta HTML / CSS / JavaScript

Interface volontairement simple, sans framework ni étape de compilation. Les données initiales sont fictives.

## Démarrer

Avec Node.js installé, depuis ce dossier :

```powershell
node server.cjs
```

Ouvrir http://127.0.0.1:4173. On peut aussi ouvrir `dist/index.html` directement pour les fonctions locales ; l’installation PWA et les notifications nécessitent HTTPS ou localhost.

## Fonctions disponibles

- Groupes, sous-groupes libres et événements réunissant plusieurs groupes.
- Participants enfants/adultes et indication des parents.
- Matchs, entraînements, événements spéciaux ; création de 4, 8 ou 12 occurrences hebdomadaires indépendantes.
- Date, heure, rendez-vous, adresse et itinéraire.
- Voitures visuelles, 2 à 9 places conducteur compris, passagers déjà présents et places supplémentaires proposées/prises séparément à l’aller et au retour.
- Statut de transport par enfant et adulte, indépendant de la capacité proposée.
- Disponibilités, sélection des joueurs et nom de l’équipe par participant.
- Missions, bénévoles et affectations : arbitres, table de marque, salle, buvette, goûter, gâteaux, maillots, accompagnement.
- Export CSV compatible Excel, export/restauration JSON, sauvegarde locale automatique.
- Import iCal avec prévisualisation ; actualisation par identifiant de rencontre FFHandball, sans effacer les réponses et l’organisation. Un match absent du fichier n’est pas annulé.
- PWA installable, cache hors ligne, journal des notifications et notification système de test.

## Calendrier FFHandball

Sur la page de compétition, choisir « Ajouter les matchs à votre calendrier », une équipe et iCal (.ics). Importer le fichier dans la bêta et choisir le groupe destinataire. On peut filtrer par nom d’équipe. L’import par URL dépend des autorisations CORS du site source ; le fichier reste la solution de repli.

Il n’y a pas encore de récupération planifiée des calendriers : réimporter pour actualiser. Les heures sans fuseau sont interprétées à Paris. Les événements sans date/titre/identifiant exploitable sont ignorés et comptabilisés dans la prévisualisation. Les convocations sont choisies par le coach.

## Supabase (optionnel)

1. Exécuter `supabase.sql` dans l’éditeur SQL du projet.
2. Créer les comptes des testeurs dans Supabase Auth avec email/mot de passe.
3. Dans Réglages, renseigner l’URL du projet et sa clé publique publishable/anon. Ne jamais utiliser de clé service_role dans le navigateur.
4. Se connecter, puis « Créer un espace avec ces données ».
5. Transmettre le code de l’espace aux testeurs ; ils se connectent puis rejoignent avec ce code.

Les données sont partagées par espace, avec lecture des changements toutes les 10 secondes lorsque l’onglet est visible. Les sauvegardes utilisent un numéro de révision : en cas de modification simultanée, la bêta bloque l’écrasement et demande d’exporter les modifications locales puis recharger. Tous les membres de l’espace ont les mêmes droits d’édition. Le bouton Mode coach n’est pas une séparation de permissions.

Le SQL et l’intégration REST sont fournis, mais doivent être vérifiés dans votre projet Supabase : aucun compte ni projet Supabase réel n’a été configuré pendant la création de cette bêta. Le partage de lien seul ne transfère pas les données locales ; les destinataires doivent rejoindre le même espace.

## Notifications

Le journal interne et le bouton de test fonctionnent dans la bêta ouverte, après autorisation. Sur iPhone, l’ajout à l’écran d’accueil est nécessaire pour le Web Push sur un système compatible.

La réception `push` et l’enregistrement des abonnements dans Supabase sont prêts. Pour recevoir une notification lorsque l’app est fermée, il manque le service serveur d’envoi et la liaison entre les actions, les destinataires et ce service. Fournir une clé publique VAPID dans Réglages permet d’enregistrer l’appareil lorsque Supabase est connecté. La clé privée VAPID et la clé Supabase service_role doivent rester exclusivement sur le serveur. Aucun push à distance, email ou SMS n’est envoyé par cette bêta.

## Vérification

```powershell
node tests.cjs
node --check dist/app.js
node --check dist/core.js
node --check dist/sw.js
```

Les tests vérifient les capacités, les sous-groupes, les doublons, les statuts indépendants, les conversions de dates et les réimportations iCal.
