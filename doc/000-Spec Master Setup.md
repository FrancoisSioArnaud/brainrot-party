Brainrot Party — Page Master Setup
Spécification complète (v3)

0. Landing globale

Route
/

Rôle
Page d’accueil unique de l’application.

Contenu
- Bouton "Créer une nouvelle partie"
  - Action :
    - POST /room (création serveur)
    - Réponse : { room_code, master_key }
    - Stockage local : brp_master_v1
    - Navigate : /master/setup
- Bouton "Joindre une partie"
  - Action : navigate("/play/enter")

---

1. Rôle de la page Setup

La page Setup permet au Master de :
- Importer 1+ exports Instagram (JSON)
- Extraire et normaliser les URLs de Reels
- Dédupliquer globalement les URLs (pool)
- Construire les Senders (auto-fusion stricte)
- Fusionner manuellement / défusionner
- Activer / désactiver des Senders
- Visualiser les métriques globales
- Générer les rounds
- Envoyer le draft final au backend via “Connecter les joueurs”

Règle fondamentale
- Aucune écriture DB : tout est stocké localement tant que “Connecter les joueurs” n’a pas été cliqué.
- La room serveur existe déjà (créée depuis la landing), et Setup vient “remplir” son état.

---

2. Accès & Cycle

Route
/master/setup

Conditions d’accès
- Accessible uniquement en mode Master.
- Si session master absente ou invalide → redirection / (landing).

Source de vérité
- localStorage.brp_master_v1 (room_code + master_key)
- localStorage.brp_draft_v1:<room_code> (draft Setup local)

Cas d’erreur
- Room expirée (réponse backend room_expired / room_not_found) :
  - clear brp_master_v1
  - clear brp_draft_v1:<room_code>
  - retour landing avec message “Room expiré”
- Draft corrompu :
  - rester sur Setup
  - afficher “Draft corrompu — reset conseillé”

---

3. Layout général

Structure : 1 colonne (mobile-first), sections empilées

Sections
1) Import Instagram JSON
2) Senders (liste + activation + rename + merge/unmerge)
3) Génération des rounds (preview + métriques)
4) “Connecter les joueurs” (envoi draft final)

---

4. Section Import

Objectif
- Ajouter des exports JSON
- Construire / enrichir la pool globale d’URLs
- Produire un report d’import

UX
- Zone drag & drop + bouton “Ajouter des fichiers”
- Affichage compteurs : files_count, shares_total, urls_unique, urls_multi_sender
- Import report (derniers fichiers) :
  - file_name
  - participants détectés
  - shares_added
  - rejected_count
  - bouton “Voir les rejets” (modal)

Modal “Rejets”
- Affiche la liste brute des liens rejetés (un par ligne)
- Aucun affichage de “reason” nécessaire côté UI

Détails Import (règles)
- Extraction stricte d’URLs Reel (instagram.com/reel/... ou /reels/...)
- Normalisation URL (https, suppression query/hash, trim)
- Dedupe URL global :
  - Si URL nouvelle → création Item dans pool
  - Si URL déjà présente → ajouter le sender à l’Item (multi-sender)

Participants détectés (report)
- Un “participant détecté” = tout sender_name rencontré dans le fichier (avant fusion)

---

5. Section Fusion des senders

Objectif
Gérer les doublons entre exports.

Règles
- Auto-fusion stricte si participant_name identique (après normalisation)
- Badge "auto"
- Fusion manuelle possible (badge "manual")
- Défusions possibles (selon règle de produit, au minimum sur auto)
- Hidden senders conservés mais exclus des calculs

IMPORTANT (ordre)
1) Auto-fusion stricte (identical names)
2) Fusions manuelles (UX)
3) Rebuild complet du draft (senders, pool, rounds, stats)

Rebuild complet (source of truth)
- Appliquer merge_map child -> root à toutes les occurrences
- Recalculer la liste des senders “root”
- Rebuild intégral de la pool URL→senders avec les senders “root”

---

6. Section Activation

Chaque ligne sender :
- Toggle active
- Nom éditable (inline rename)
- “a envoyé X reels”
- Si 0 reel → grisé et auto-désactivé

Effet
Désactiver un sender :
→ régénère pool filtrée + rounds + stats

Règle d’exclusion
- Sender inactive : retiré de `active_senders`
- Retiré des Items (si un Item devient vide → supprimé)

---

7. Génération des rounds

Règles & objectifs

Objectif : produire des rounds où **chaque sender actif apparaît au maximum une fois par round**.
Conséquence : un Item multi-sender “consomme” plusieurs senders dans ce round, et le round peut donc contenir moins d’Items que le nombre de senders actifs.

Invariants
- **Dedupe global URL** : une URL (Item) n’apparaît **qu’une seule fois** dans toute la partie.
- Un Item = 1 URL + `true_sender_ids[]` (1..N) (les senders réellement associés à cette URL).
- Dans un round, un sender ne peut appartenir qu’à **un seul** Item :
  - Pour tout sender `S`, il existe **au plus un** Item du round tel que `S ∈ item.true_sender_ids`.
- Après la génération, les Items d’un round sont **triés** par nombre de senders décroissant (multi d’abord).

Terminologie
- `pool` : liste globale des Items (URL dédupliquées) avec leurs `true_sender_ids`.
- `used` : Items déjà consommés (donc indisponibles pour les rounds suivants).
- `remaining_count_by_sender[S]` : nombre d’Items **non utilisés** dans la pool où `S` apparaît (mono + multi).

Pipeline (ordre exact)

1) Construire les senders (auto-fusion stricte)
- À partir des imports, normaliser `participant_name`.
- Si `participant_name` identique → **même sender** (auto).

2) Appliquer les fusions manuelles
- Après l’étape auto, l’UX permet des merges manuels.
- Source de vérité : un mapping `merge_map` (child → root).
- Ensuite, **rebuild complet** :
  - Remapper chaque occurrence de sender vers son root.
  - Re-dedupe des senders (root unique).
  - Rebuild de la pool URL→senders (voir 3).

3) Construire la pool d’Items (URL dédupliquées)
- Itérer toutes les “shares” importées :
  - Normaliser l’URL Reel.
  - Si URL nouvelle → créer un Item.
  - Si URL déjà existante → ajouter le sender (root) à `true_sender_ids`.
- Résultat : `pool = [ { url, true_sender_ids:Set(root_sender_id) } ... ]`.

4) Filtrer par activation
- Les senders `active=false` sont exclus **partout** :
  - retirés de `active_senders`
  - retirés des Items (si un Item ne contient plus de sender actif → item supprimé)
  - retirés du calcul `remaining_count_by_sender`

5) Randomisation déterministe + regroupement par buckets (2+ puis 1)
- Entrée : `pool` filtrée, `seed`.
- Étape A : shuffle stable/déterministe de toute la pool avec `seed`.
- Étape B : regroupement en 2 buckets, en conservant l’ordre relatif (shuffle déjà fait) :
  1. Bucket `multi`: tous les Items avec `len(true_sender_ids) >= 2` (randomisés entre eux via le shuffle)
  2. Bucket `mono`: tous les Items avec `len(true_sender_ids) == 1` (randomisés entre eux via le shuffle)
- Pool finale d’itération : `pool_iter = multi_bucket + mono_bucket`.

6) Initialiser les compteurs restants
- Pour chaque sender actif `S` :
  - `remaining_count_by_sender[S] = count(items in pool_iter where S ∈ item.true_sender_ids)`

7) Génération round par round (itération séquentielle)

Variables par round
- `remaining_to_fill` : set des senders “à trouver” pour ce round.
- `round_items[]` : Items retenus dans ce round.
- `round_has_multi` : booléen (**au plus 1 multi par round**).

Initialisation d’un round
- `remaining_to_fill = set(active_senders)`
- Retirer immédiatement tout sender `S` tel que `remaining_count_by_sender[S] == 0`
  (on ne le cherche plus, car il n’a plus aucun reel disponible dans la pool).

Remplissage (scan pool)
- Pour chaque `item` dans `pool_iter` dans l’ordre :
  - Skip si `item.used == true`
  - Si `round_has_multi == true` et `len(item.true_sender_ids) >= 2` → skip (mono-only après multi)
  - Test “fit” :
    - Condition : `item.true_sender_ids ⊆ remaining_to_fill`
  - Si fit :
    - Ajouter `item` à `round_items`
    - Marquer `item.used = true`
    - Pour chaque sender `S` dans `item.true_sender_ids` :
      - `remaining_to_fill.remove(S)`
      - `remaining_count_by_sender[S] -= 1`
    - Si `len(item.true_sender_ids) >= 2` :
      - `round_has_multi = true`
  - Après chaque ajout, retirer de `remaining_to_fill` tout sender `S` tel que `remaining_count_by_sender[S] == 0`
  - Stop round si `remaining_to_fill` est vide.

Fin de round
- Si `round_items` est vide → stop génération globale (plus rien de jouable).
- Sinon :
  - Trier `round_items` par `len(true_sender_ids)` décroissant.
  - Ajouter le round à `rounds[]`.

8) Sorties
- `rounds[]` : liste de rounds, chaque round = liste ordonnée d’Items.
- `round_order[]` : ordre d’exécution des rounds (par défaut séquentiel r1..rN).
- Stats recommandées à exposer dans Setup :
  - `active_senders`
  - `items_total` (taille pool)
  - `items_multi` / `items_mono`
  - `rounds_generated`
  - `senders_dropped` (nb de senders retirés car `remaining_count==0` lors de la génération)
  - `items_used` (total)

---

8. "Connecter les joueurs" (envoi draft final)

Conditions :
- ≥ 1 fichier importé
- ≥ 2 senders actifs
- session master valide (room_code + master_key)

Action (ordre)
1) Valider / reconstruire le draft final (senders, pool, rounds, round_order, stats)
2) POST /room/:code/setup
   - Auth : master_key (header ou body, unique et obligatoire)
   - Payload :
     - senders (visibles + actifs)
     - rounds
     - round_order
     - seed
     - protocol_version
     - metrics (optionnel)
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
