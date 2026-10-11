# État des notifications Lumo — 11 octobre 2026

- Frontend : boîte de notifications Supabase, lecture, préférences, inscription Web Push volontaire, test personnel, désactivation appareil, nettoyage de tous les clubs de l’appareil avant déconnexion.
- Tutoriels : parents, covoiturage commun, voiture de secours, coups de main, coach, installation Android/iPhone et permissions. GUIDE.md est le guide utilisateur.
- Supabase mxfgtcubzdhkmtcyqznp : supabase/push.sql appliqué ; fonction lumo-push déployée ACTIVE, version 1. Le cron lumo-push-every-minute est programmé chaque minute.
- Sécurité : jeton cron aléatoire dans Vault ; authentification personnalisée dans la fonction ; clés serveur jamais dans le frontend ni dans le dépôt ; endpoint push limité aux fournisseurs standards. RPC serveur accessibles à service_role uniquement.
- Les clés VAPID sont générées automatiquement par la fonction à sa première invocation autorisée. À l’arrêt demandé, le jeton cron existait, mais la première invocation et la création des clés n’étaient pas encore confirmées. Ne pas annoncer une notification téléphone reçue sans test réel.
- Vérifications réalisées : deno check, dépendance web-push 3.6.7 et deno.lock figés, syntaxe notifications.js/help.js/sw.js valide. Aucun envoi à des utilisateurs réels.
- À vérifier ensuite : réponse HTTP du cron, présence des clés VAPID dans Vault sans afficher leur valeur, test volontaire sur un vrai téléphone. Sur iPhone/iPad : application ajoutée à l’écran d’accueil, iOS/iPadOS 16.4+.
- Intégration frontend : charger notifications.js/help.js/help.css ; initialiser LumoNotifications avec rpc/api/clubId/userId ; API chemins sans préfixe REST ; await LumoNotifications.logout() avant signOut. Les autres fichiers de l’application sont intégrés par l’agent principal.
