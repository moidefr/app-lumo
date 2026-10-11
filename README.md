# Lumo — bêta HTML / CSS / JavaScript

Interface volontairement simple, sans framework ni étape de compilation. Les données initiales sont fictives.

## Démo complète du club

Nom du club : Handball Club Crest Pays de Saillans. Les noms des personnes, rencontres, lieux, horaires et missions sont fictifs, sans lien avec le calendrier réel du club.

La démo contient 11 groupes/sous-groupes, 49 participants (26 enfants et 23 adultes), 12 événements et 6 notifications simulées. Les exemples couvrent un retour incomplet, un match entièrement organisé, un match à domicile, un tournoi intergroupes avec un véhicule 9 places, quatre entraînements hebdomadaires, un déplacement senior, une soirée, un match annulé et un exemple de provenance calendrier. Des missions sont déjà affectées, d’autres attendent des bénévoles.

Le bouton « Charger la démo complète » conserve les données précédentes sur l’appareil. Pour les récupérer : Réglages → Restaurer les données avant la démo. Le premier chargement remplace automatiquement l’ancien exemple de cinq enfants et en garde une copie. Les espaces Supabase connectés ne sont pas remplacés. Aucune connexion Supabase n’a été ajoutée pour cette version.

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

## Supabase et comptes

Le backend est décrit dans `README-BACKEND.md` (schéma `supabase.sql`, RPC, RLS, tests `tests-backend.sql`). Le frontend utilise `config.js` (URL et clé publique publishable uniquement, jamais de clé service_role) et `cloud.js` (auth + RPC).

1. Créer un compte, se connecter, puis créer un club (`create_lumo_club`) ou rejoindre avec une invitation valide 7 jours (`join_lumo_club`).
2. Le responsable attribue les rôles et rattache les enfants aux comptes parents dans Accès et familles.
3. Les modifications passent par `save_lumo_club` avec contrôle de révision ; les droits sont appliqués par la base (parents : leur famille, voitures et missions ; admins/coachs : organisation).

Ne pas rejouer `supabase.sql` sur la base déjà migrée.

## Notifications

Boîte de notifications Supabase, préférences, test personnel et Web Push par appareil (`notifications.js`, `sw.js`). L'envoi est assuré par la fonction `supabase/functions` (`lumo-push`) et le cron défini dans `supabase/push.sql` ; l'état de déploiement est dans `supabase/NOTIFICATIONS-STATUS.md`. La réception sur un téléphone réel reste à confirmer. Le guide utilisateur est `GUIDE.md`.
