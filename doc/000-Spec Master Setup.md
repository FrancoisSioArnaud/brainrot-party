Brainrot Party — Page Master Setup


0. Landing globale

Route
/

Rôle
Page d’accueil unique de l’application.

Contenu
- Bouton "Créer une nouvelle partie" → navigate("/master/setup")
- Bouton "Joindre une partie" → navigate("/play/enter")

Aucune room serveur n’est créée ici.
Aucun draft n’est créé ici.

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
- Connecter les joueurs (création réelle de la room serveur)

Tout est stocké en draft local (state + localStorage).

---

2. Accès & Cycle

Conditions d’accès
- Accessible uniquement en mode Master.
- Si aucun draft local → redirection vers "/"

Source de vérité
- localStorage.brp_draft_v1
- État mémoire React synchronisé avec localStorage

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
- Bouton "Réinitialiser ma room"

---

4. Section Import

Fonctionnalités
- Drag & Drop JSON Instagram
- Parsing messages[].share.link
- Extraction participant_name
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
→ rebuild complet du draft

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
- rounds_max = nb reels du 2e sender
- rounds_complete = min reels parmi actifs

---

8. Bouton "Connecter les joueurs"

Conditions :
- ≥ 1 fichier importé
- ≥ 2 senders actifs

Action :
POST /room avec :
- senders visibles
- rounds
- round_order

Backend génère :
- room_code
- master_key

Redirection :
navigate("/master/lobby")

---

9. Réinitialiser ma room

Action :
- Si room serveur existe → la fermer
- Clear draft local
- Redirection → "/"
