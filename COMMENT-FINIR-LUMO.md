# Comment finir Lumo

Guide de reprise — 17 octobre 2026.

## Commence ici

Le projet à continuer est dans **`C:\Users\G\Dev\2-c\app-lumo`**.

Ce dossier contient déjà des améliorations faites après notre première session : entraînements, réponses habituelles, attribution des places, écrans famille et retouches d’interface. Ces fichiers et leurs modifications en cours ont été conservés. **Ne remplace pas ce dossier par l’ancienne version.**

Une archive de notre version précédente est disponible dans `_archives/lumo-session-2026-10-11.zip`. Elle sert de sauvegarde et de référence ; elle n’est pas la version à lancer.

Le but maintenant : vérifier un parcours complet parent/coach, terminer les notifications et les réglages de connexion, puis ouvrir le site aux parents. Le code présent ne prouve pas, à lui seul, que tous ces parcours fonctionnent sur le site en ligne.

## 1. Lancer sur ton PC

Ouvre le dossier dans ton éditeur, puis un terminal à cet emplacement :

```powershell
cd C:\Users\G\Dev\2-c\app-lumo
npm start
```

Ouvre **http://127.0.0.1:4173**. Pour arrêter le serveur, fais `Ctrl+C`.

Si `npm` n’est pas reconnu, installe Node.js LTS puis rouvre le terminal. Avec Node installé, `node server.cjs` fonctionne aussi.

Il n’y a pas de compilation à faire : le site est en HTML/CSS/JavaScript dans `dist/`. Utilise le serveur plutôt qu’un double-clic sur `index.html`, notamment pour l’installation et les notifications.

## 2. Comprendre ce qui existe

| Partie | État connu |
| --- | --- |
| Charte graphique | Bleu/turquoise, polices et composants intégrés. |
| Interface | Accueil, calendrier, famille, groupes, voitures, équipes, bénévolat et aide présents. Des modifications locales sont en cours. |
| Démo | Données fictives conservées séparément du club réel. Vérifier cette séparation lors des tests. |
| Supabase | Connexion prévue dans le code ; schéma et règles d’accès appliqués et testés pendant la session du 11 octobre. L’état distant actuel n’a pas été revérifié le 17 octobre. |
| Droits | Parent, coach et administrateur contrôlés par la base. Les parents sont associés à leurs enfants par l’administrateur. |
| Notifications | Interface, fonction serveur et tâche planifiée préparées/déployées le 11 octobre. Réception sur un vrai téléphone encore à confirmer. |
| Matchs FFHandball | Import de calendrier `.ics` disponible. Récupération automatique planifiée encore à terminer. |
| Site en ligne | Ne pas supposer qu’il correspond à tous les fichiers locaux. Vérifier la version et les accès avant d’inviter les parents. |

Les fichiers `README-BACKEND.md` et `supabase/NOTIFICATIONS-STATUS.md` décrivent précisément le travail serveur effectué le 11 octobre. Le `README.md` contient aussi des descriptions historiques : en cas de contradiction, vérifier le code actuel et les services.

## 3. Finir la connexion Supabase

Projet utilisé : **`mxfgtcubzdhkmtcyqznp`**.

Dashboard : https://supabase.com/dashboard/project/mxfgtcubzdhkmtcyqznp

Dans `dist/config.js`, l’adresse Supabase et la clé publique du navigateur sont déjà renseignées. **Ne mets jamais de clé `service_role`, de clé secrète Supabase ou de clé privée VAPID dans `dist/`.**

Dans le dashboard, vérifie :

1. **Authentication → URL Configuration** : adresse finale du site et URLs de redirection autorisées.
2. Pour les essais locaux : autoriser `http://127.0.0.1:4173`. Le `siteUrl` de `dist/config.js` détermine l’adresse utilisée par le code pour les liens de connexion/récupération ; l’adapter au test puis à l’hébergement final.
3. **Authentication → Email / SMTP** : vérifier qu’un parent peut réellement recevoir son message de connexion ou confirmation. Prévoir un fournisseur d’envoi adapté avant l’ouverture au club.
4. Si l’écran utilise un **code de connexion**, vérifier que le modèle d’email contient bien ce code. Un email contenant seulement un lien ne suffit pas pour un écran qui demande un code.
5. Vérifier aussi le parcours « mot de passe oublié » s’il est proposé dans l’interface.

Les emails servent ici à accéder au compte. Pour les matchs, le choix retenu reste **notifications sur téléphone + dans Lumo**, sans emails de notification.

**Résultat attendu :** créer un compte, recevoir le bon message, se connecter et retrouver le même espace après rechargement.

Ne rejoue pas tout `supabase.sql` sur une base déjà configurée. Pour une évolution, préparer une migration ciblée et tester les droits. Lire d’abord `README-BACKEND.md`.

## 4. Tester avec deux comptes

Avant de saisir des données réelles d’enfants, utilise un espace clairement nommé « Test Lumo » et des participants fictifs.

1. Avec ton compte responsable, crée l’espace de test.
2. Ajoute un groupe, un participant et un match à une date future.
3. Crée une invitation dans les réglages.
4. Dans un autre navigateur ou profil, crée/connecte le compte parent et rejoins cet espace.
5. Avec le responsable : ouvre **Accès et familles**, associe le participant au parent.
6. Avec le parent : réponds à la disponibilité et au transport aller/retour.
7. Avec le coach : vérifie les réponses, choisis l’équipe et publie la convocation.

**Résultat attendu :** les deux comptes voient les changements ; le parent ne peut pas modifier une autre famille ni publier une équipe.

Le dossier contient des modifications non enregistrées dans Git sur `dist/app.js`, `dist/family.js` et `dist/ui.css` au moment de cette reprise. Elles ont été laissées intactes. Relis-les avant d’effectuer un nouveau commit ou une refonte.

## 5. Vérifier le covoiturage et les entraînements

Teste ces cas en priorité :

- Réservation ou attribution d’une place pour un enfant **sans choisir une voiture** ; vérifier le comportement actuel d’attribution automatique.
- Aller et retour indépendants : une place à l’aller ne doit pas garantir le retour.
- Conducteur et passagers déjà présents comptés correctement dans la capacité.
- Deux parents qui demandent la dernière place en même temps : pas de double réservation.
- Annulation d’une réponse, absence et retrait d’une voiture : pas de place fantôme ni de réservation perdue silencieusement.
- Voiture « seulement si besoin » : proposition de regroupement cohérente, décision explicite avant retrait.
- Entraînement : présence seule, réponse habituelle, modification d’une séance et covoiturage ajouté par un parent.
- Skin de voiture conservé après rechargement.
- Bénévolat : s’inscrire, voir son nom puis se retirer.
- Modification hors connexion, reconnexion et conflit entre deux appareils : aucune modification ne doit écraser silencieusement celle d’une autre personne.

Les changements récents sur l’attribution automatique et les entraînements doivent aussi être acceptés par les règles Supabase. Une démo locale qui fonctionne ne suffit pas à valider les sauvegardes partagées.

## 6. Terminer les notifications

Lis **`supabase/NOTIFICATIONS-STATUS.md`** avant de modifier cette partie.

Lors de la session du 11 octobre : fonction `lumo-push` déployée, cron chaque minute configuré et secret du cron protégé dans Vault. La première génération des clés VAPID et la réception sur téléphone n’avaient pas encore été confirmées. Vérifier leur état actuel plutôt que redéployer à l’aveugle.

À faire dans cet ordre :

1. Vérifier les logs de `lumo-push` et l’exécution de la tâche planifiée.
2. Vérifier que les clés VAPID existent, **sans afficher ni copier la clé privée**.
3. Avec le compte parent sur téléphone, activer les notifications depuis Lumo et accepter la permission du navigateur.
4. Envoyer un test depuis Lumo et vérifier la réception réelle.
5. Fermer Lumo, publier une convocation depuis le coach puis vérifier que le téléphone reçoit l’alerte.
6. Tester les changements d’horaire et les rappels prévus la veille et deux heures avant le rendez-vous.
7. Se déconnecter d’un appareil partagé : il ne doit plus recevoir les alertes de l’ancien compte.

L’aide intégrée explique l’installation Android/iPhone. Tester aussi les permissions refusées : les alertes doivent rester consultables dans Lumo. Éviter les noms d’enfants dans le texte affiché sur l’écran verrouillé.

## 7. Finir l’import automatique des matchs

Le fichier `.ics` importé à la demande permet déjà d’avancer. Pour automatiser :

1. Identifier une source calendrier FFHandball stable pour l’équipe.
2. Faire la récupération côté serveur, avec une fréquence raisonnable.
3. Reconnaître les matchs par identifiant pour éviter les doublons.
4. Mettre à jour les horaires et les lieux sans effacer les réponses, les voitures ou les bénévoles.
5. Gérer les annulations explicites et les alertes de changement.
6. Prévoir un message clair si la source ne répond plus.

Ne considère pas un match absent d’un import comme automatiquement annulé.

## 8. Mettre la bonne version en ligne

Adresse historique : https://handclub-beta-01a12ad4.wholedove.chatgpt.site

L’accès connu pendant notre session était privé au propriétaire. **Une invitation au club dans Lumo ne donne pas automatiquement accès à un hébergement privé.** Vérifier les paramètres actuels et choisir l’accès destiné aux parents avant l’ouverture.

Pour publier, utiliser le dossier actuel. Le contenu servi est `dist/`. `.openai/hosting.json` conserve l’identité du site existant. Si tu changes d’hébergeur, mettre à jour `siteUrl` et les redirections Auth Supabase.

Avant l’ouverture : tester sur téléphone, vérifier les comptes et les droits, prévoir des sauvegardes et une procédure pour corriger/supprimer les données d’une famille. Ne rends jamais les tables accessibles à tous pour contourner un problème de connexion.

## Où modifier quoi

| Fichier | Rôle |
| --- | --- |
| `dist/index.html` | Page de base et chargement des scripts |
| `dist/app.js` | Navigation, écrans et actions principales |
| `dist/family.js` | Écrans et comportements de famille ajoutés ensuite |
| `dist/core.js` | Groupes, participants, import et calculs métier |
| `dist/domain.js` | Réservations et fusion des modifications |
| `dist/cloud.js` | Connexion et échanges avec Supabase |
| `dist/config.js` | Configuration publique du projet |
| `dist/notifications.js` | Alertes et inscription des appareils |
| `dist/sw.js` | Cache de l’application et réception du push |
| `dist/help.js`, `GUIDE.md` | Aide destinée aux utilisateurs |
| `dist/style.css`, `practical.css`, `ui.css` | Charte et mise en page |
| `supabase.sql`, `supabase/push.sql` | Schéma et fonctions serveur |
| `supabase/functions/lumo-push/` | Envoi des notifications |
| `tests.cjs`, `tests-backend.sql` | Vérifications automatiques |

## Commandes de vérification

```powershell
npm test
node --check dist/app.js
node --check dist/family.js
node --check dist/core.js
node --check dist/domain.js
node --check dist/cloud.js
node --check dist/notifications.js
node --check dist/sw.js
```

Les tests automatiques ne remplacent pas les essais avec deux comptes et un vrai téléphone. Ne lance pas les tests SQL sur les données du club sans lire le script et vérifier qu’il utilise bien sa transaction de test annulée.

## Prompt pour reprendre avec un assistant

> Travaille dans C:\Users\G\Dev\2-c\app-lumo. Lis COMMENT-FINIR-LUMO.md, README-BACKEND.md et supabase/NOTIFICATIONS-STATUS.md. Préserve les modifications locales existantes. Commence par tester la version actuelle, puis termine le parcours avec deux comptes parent/coach, la compatibilité Supabase des entraînements et de l’attribution des places, les conflits de synchronisation et les notifications sur téléphone. Vérifie l’état distant avant toute migration ou redéploiement. Garde la charte et la séparation démo/données réelles. Ne rends pas les données publiques et ne mets aucune clé secrète dans le navigateur. Indique les points non vérifiés avant la publication.
