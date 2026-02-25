Brainrot Party — Page Master Setup
Spécification complète (v4)

0. Landing globale

Route
/

Rôle
Page d’accueil unique de l’application.

Contenu
- Bouton "Créer une nouvelle partie"
  - Action :
    1) POST /room
    2) reçoit { room_code, master_key }
    3) stocke la session master (ex: localStorage.brp_master_v1)
    4) navigate("/master/setup")

- Bouton "Joindre une partie"
  - navigate("/play/enter")

Notes importantes
- Le `master_key` est obtenu une seule fois via HTTP (création room), puis :
  - utilisé pour authentifier l’envoi du setup final via HTTP (POST /room/:code/setup)
  - utilisé aussi côté Master (uniquement) pour ouvrir le WebSocket en mode master (JOIN_ROOM avec master_key)
- Le `master_key` ne doit jamais être saisi ni connu côté Play.

---

1. Rôle de la page Setup

Route
/master/setup

La page Setup permet au Master de :
- Importer 1+ exports Instagram (JSON)
- Extraire et normaliser les URLs de Reels
- Dédupliquer globalement les URLs
- Construire les Senders (auto-fusion stricte)
- Fusionner manuellement / défusionner
- Activer / désactiver des Senders
- Générer les rounds
- Visualiser les métriques globales
- Envoyer le draft final au backend (dans la room existante)
- Aller au Lobby pour connecter les joueurs

Source de vérité côté Setup (draft local)
- localStorage.brp_draft_v1 (lié à un room_code)
- état mémoire React synchronisé avec localStorage

⚠️ La room serveur existe déjà (créée sur la Landing via POST /room).
Setup ne crée pas la room serveur : il construit un draft local puis l’envoie au backend.

---

2. Accès & Cycle

Pré-requis
- Une session master valide doit exister :
  - localStorage.brp_master_v1 = { room_code, master_key }

Au mount (logique de garde)
1) Si brp_master_v1 absent → navigate("/") (Landing)

2) Si brp_master_v1 présent :
   - Setup crée / charge le draft local associé au room_code
   - Si le draft est corrompu (JSON invalide, version inconnue, structure incohérente)
     → rester sur /master/setup + afficher erreur + proposer "Réinitialiser le draft"

3) Si le backend répond room_not_found / room_expired lors d’un call requis
   → clear session master + clear draft associé + navigate("/") avec erreur "Room expiré"

Note
- Un draft est “associé” à un room_code. Un draft d’un autre room_code ne doit jamais être réutilisé.

---

3. Layout

Structure 2 colonnes

Colonne gauche (scrollable)
1. Section Import
2. Section Fusion
3. Section Activation
4. Bouton sticky "Connecter les joueurs"

Colonne droite (sticky)
- Stats globales
- Bouton "Réinitialiser le draft"

---

4. Section Import

Fonctionnalités
- Drag & Drop JSON Instagram
- Parsing messages[].share.link
- Extraction participant_name (tolérant selon structure export)
- Normalisation stricte des URLs
- Déduplication globale

Affichage
Table fichiers importés :
- messages_found
- participants_found
- urls_extracted
- urls_rejected
- bouton retirer

Bouton :
- Export CSV des URLs rejetées

Règle clé
À chaque ajout/retrait de fichier :
→ rebuild complet du draft (senders, reels, rounds, stats)

---

5. Section Fusion Senders

Objectif
Gérer les doublons entre exports.

Règles
- Auto-fusion stricte si participant_name identique
- Badge "auto"
- Fusion manuelle possible (badge "manual")
- Défusions possibles uniquement pour "auto"
- Hidden senders conservés mais exclus des calculs

---

6. Section Activation

Liste triée par nombre de reels décroissant.

Chaque ligne :
- Toggle active
- Nom éditable
- Badge auto/manual
- "a envoyé X reels"
- Si 0 reel → grisé et auto-désactivé

Effet
Désactiver un sender :
→ régénère rounds + stats

---

7. Génération des rounds

Règles importantes :
- Chaque URL n’apparaît qu’une seule fois dans toute la partie
- Items multi-senders autorisés
- k = true_sender_ids.length

Tri :
1. Multi-senders d’abord
2. k desc
3. Shuffle stable

Calculs :
- rounds_max = nb reels du 2e sender (actif, tri desc)
- rounds_complete = min reels parmi actifs

---

8. "Connecter les joueurs" (envoi draft final)

Conditions :
- ≥ 1 fichier importé
- ≥ 2 senders actifs
- session master valide (room_code + master_key)

Action (ordre)
1) Valider / reconstruire le draft final (senders, rounds, round_order, stats)
2) POST /room/:code/setup
   - Auth : header `x-master-key: <master_key>` (obligatoire)
   - Payload :
     - senders (visibles + actifs)
     - rounds
     - round_order
     - seed (si utilisé)
     - protocol_version (si utilisé)
3) Si OK :
   - navigate("/master/lobby")

Erreurs
- room_expired / room_not_found :
  - clear session master + clear draft lié
  - navigate("/") + message "Room expiré"
- validation_error :
  - rester sur Setup + afficher message clair (ce qui manque / incohérent)

---

9. Réinitialiser le draft

Action
- Clear draft local (brp_draft_v1 pour le room_code courant)
- Rester sur /master/setup
- Afficher un état vide (import = 0)

Note
- Ce bouton ne ferme pas forcément la room serveur.
  (La room serveur suit son TTL ou est fermée ailleurs, selon les specs room lifecycle.)

---

10. Accès Master au WebSocket (important)

Le Master ouvre le WebSocket en mode “master” en envoyant `master_key` au JOIN.

- Message WS : JOIN_ROOM
- Payload contient :
  - room_code
  - device_id
  - protocol_version
  - master_key (uniquement côté Master)

Si le master_key est valide :
- la connexion a `is_master=true`
- le serveur peut inclure des champs master-only dans STATE_SYNC_RESPONSE
- la UI Master (Lobby/Game) peut afficher des infos non visibles côté Play
