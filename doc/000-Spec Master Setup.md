
# Brainrot Party — Page Setup
Spécification complète (MVP) — v2 (alignée specs actuelles)

Décisions intégrées (tes réponses) :
- Rounds construits côté Setup et envoyés au serveur (CREATE_ROOM) (1A)
- IDs stables générées côté Setup (2A)
- “Connecter les joueurs” = appel CREATE_ROOM serveur (3A)
- “Réinitialiser ma room” ferme aussi la room serveur si existante (ROOM_CLOSED) (4B)
- `master_key` stocké en localStorage (5A)
- Upload serveur minimal : senders + rounds uniquement (6A)
- Ordre items : multisender d’abord, tri desc par k, puis pseudo-aléatoire **stable** (seed) (7A)
- Seed déterministe généré côté Setup et stocké dans draft (8A)
- Rounds construits jusqu’à `rounds_max` (2e sender), avec senders absents sur les derniers rounds (9B)
- ReelItems filtrés aux senders actifs au moment de “Connecter les joueurs” (10A)
- Players manuels : **créables uniquement au Lobby master** (pas en Setup) (11C)
- Avatars uniquement Lobby (12A)

---

## 1. Rôle de la page
La page Setup permet au Master de :
- Importer 1+ exports Instagram (JSON)
- Extraire et normaliser les URLs de Reels
- Dédupliquer globalement les URLs
- Construire les Senders (auto-fusion stricte)
- Fusionner manuellement / défusionner
- Activer / désactiver des Senders
- Visualiser les métriques globales
- Générer la structure de jeu (Rounds + Items) **localement**
- Créer une room serveur via “Connecter les joueurs” (CREATE_ROOM) et basculer vers le Lobby

À ce stade :
- Tout le parsing et la construction restent **locales** (state + localStorage).
- Aucune BDD.
- La room serveur n’existe **qu’après** “Connecter les joueurs”.

---

## 2. Accès & Cycle
Route : `/master/setup`

Conditions d’accès :
- Accessible uniquement en mode Master
- Si aucun draft local → redirection vers `/master` (Landing)

Source de vérité :
- `localStorage.brp_draft_v1`
- État mémoire React synchronisé avec localStorage

---

## 3. Layout
Structure 2 colonnes

Colonne gauche (scrollable) :
1. Section Import
2. Section Fusion
3. Section Activation Senders
4. Bouton sticky “Connecter les joueurs”

Colonne droite (sticky) :
- Panneau statistiques globales
- Bouton “Réinitialiser ma room”

---

## 4. Modèle de données local (Draft)

### 4.1 Identifiants (stables)
- `draft_version: "brp_draft_v1"`
- `local_room_id: UUID` (instance locale du draft)
- `seed: string` (seed déterministe pour shuffle stable des items)
- `server_room?: { code: string; master_key: string }` (présent après CREATE_ROOM)

### 4.2 Entités principales

#### files[]
```ts
{
  id: string,             // file_id stable (ex: f_<hash(filename+size+firstBytes)>)
  name: string,
  messages_found: number,
  participants_found: number,
  rejected_urls: string[],
  errors_count: number
}
````

#### senders[]

> `sender_id` stable généré côté Setup (pas “local”).

```ts
{
  sender_id: string,              // s_<hash(file_id + participant_name)> puis fusion modifie le mapping
  display_name: string,
  original_names_by_file: [
    { file_id: string, file_name: string, participant_name: string, reel_count: number }
  ],
  reel_urls_set: string[],        // stocké en array (serialization). Utiliser Set en runtime.
  reel_count_total: number,
  active: boolean,
  hidden: boolean,                // senders masqués suite fusion manuelle
  badge: "none" | "auto" | "manual"
}
```

#### reelItemsByUrl

```ts
{
  [normalized_url: string]: {
    url: string,
    sender_ids: string[]           // sender_id (après fusion + filtres)
  }
}
```

#### rounds[]

Structure générée localement, prête à être envoyée au serveur.

```ts
{
  round_id: string,                // r1, r2, ...
  items: [
    {
      item_id: string,             // i_<roundIndex>_<itemIndex>
      reel: { reel_id: string, url: string },  // reel_id = reel_<shortcode> (stable)
      true_sender_ids: string[]    // 1..N sender_ids (multi-slot => k>1)
    }
  ]
}
```

---

## 5. Section 1 — Import JSON

### 5.1 UI

* Titre : “Import”
* Dropzone + bouton “Ajouter des fichiers”
* Table fichiers importés :

| Fichier | Messages trouvés | Participants trouvés | Erreurs | Action  |
| ------- | ---------------: | -------------------: | ------: | ------- |
| …       |                … |                    … |       … | Retirer |

Sous-table :

* Si erreurs > 0 → bouton “Exporter URLs rejetées (CSV)”

### 5.2 Parsing

Déclenchement :

* Ajout fichier
* Suppression fichier

UX :

* Spinner overlay global
* Message : “J’en ai pour un instant…”
* UI bloquée pendant parsing

### 5.3 Extraction

Source : `messages[].share.link`

### 5.4 Normalisation URL

Conserver uniquement :
`https://www.instagram.com/{reel|p|tv}/{shortcode}/`

Règles :

* HTTPS forcé
* suppression querystring
* suppression fragments
* trailing slash normalisé

### 5.5 Données calculées par fichier

Pour chaque fichier :

* `messages_found`
* `participants_found` (unique participant_name dans ce fichier)
* `errors_count`
* `rejected_urls[]`

### 5.6 Déduplication globale

Une URL normalisée = 1 ReelItem global.
Si plusieurs senders ont partagé la même URL :

* Un seul ReelItem
* `sender_ids` multiples

### 5.7 Suppression fichier

Si fichier retiré :

* Rebuild complet du draft
* Recalcul senders
* Recalcul reelItemsByUrl
* Recalcul stats
* Re-génération rounds

### 5.8 Export CSV des rejets

Format :

```
### message1.json
url1
url2

### message2.json
url3
```

Contenu : URL brute rejetée.

---

## 6. Section 2 — Fusion des Senders

### 6.1 Activation

* Enabled si ≥ 2 fichiers importés
* Sinon grisé

### 6.2 Résumé affiché

* “X fusions automatiques”
* “Y fusions manuelles”

### 6.3 Auto-fusion

Si `participant_name` strictement identique cross-files :

* Fusion automatique
* Badge “Fusion Auto”
* Provenance listée : Julie dans [file1] + Julie dans [file2]

### 6.4 Modale Fusion

Tableau unique
Colonnes :

* Checkbox
* Sender
* Provenance
* Reels
* Badge
* Actions

Types :

| Type   | Badge           | Action      |
| ------ | --------------- | ----------- |
| Normal | none            | —           |
| Auto   | Fusion Auto     | Défusionner |
| Manuel | Fusion Manuelle | —           |

### 6.5 Fusion manuelle

* Sélection ≥ 2 senders
* Bouton “Fusionner”
* Mini-form :

  * Nom pré-rempli
  * Modifiable

Effet :

* Nouveau sender `badge="manual"`
* `reel_urls_set` = union
* anciens senders → `hidden=true`
* recalcul stats instantané
* re-génération rounds instantanée

### 6.6 Défusion auto

* Action “Défusionner” seulement pour badge “auto”
* Split en N senders :

  * Julie (message1.json)
  * Julie (message2.json)
* Badge supprimé
* Recalcul stats + re-génération rounds

---

## 7. Section 3 — Activation des Senders

### 7.1 Activation

Enabled si ≥ 1 fichier importé.

### 7.2 Liste senders

Tri : `reel_count_total` décroissant.

Chaque ligne :

* Toggle Actif
* Nom (editable)
* Texte : “a envoyé X reels”
* Badge (Auto / Manuel)
* État grisé si `reel_count_total=0`

### 7.3 Règles

* `reel_count_total=0` → exclu automatique (grisé, non activable)
* désactivation :

  * `sender.active=false`
  * recalcul reelItemsByUrl & stats
  * re-génération rounds instantanée
* aucune gestion Player ici
* les `hidden=true` restent exclus partout

---

## 8. Panneau Stats (colonne droite)

Sticky.

Contenu :

* Senders actifs
* ReelItems uniques (sur base senders actifs)
* Rounds max (2e sender)
* Rounds complets (min sender)
* Senders dédoublonnés (post fusion manuelle)
* Rejets total

Calculs :

* `activeSenders = senders.filter(active && !hidden && reel_count_total>0)`
* `uniqueReels = count(reelItemsByUrl après filtre activeSenders)`

Rounds max :

* sort desc `reel_count_total` (activeSenders)
* value = 2e élément (si >=2, sinon “—”)

Rounds complets :

* value = min `reel_count_total` among activeSenders
* si <2 senders actifs → “—”

---

## 9. Génération des rounds (local)

### 9.1 Entrée

* `activeSenders` (après fusion/activation/filtre reels>0)
* `reelItemsByUrl` filtré aux `activeSenders` (10A)
* `seed` (8A)

### 9.2 Règles de construction

* Un item = 1 Reel URL + 1..N `true_sender_ids` (multi-slot)
* Les reels multi-senders apparaissent **une seule fois** avec `k > 1`
* Pas d’items partiels

### 9.3 Nombre de rounds

* On construit jusqu’à `Rounds max` (9B)
* Donc certains senders peuvent être absents sur les derniers rounds si ils ont moins de reels

### 9.4 Ordre des items dans chaque round

1. Items multi-senders en premier
2. Tri décroissant par `k`
3. Shuffle pseudo-aléatoire **stable** (seed) à l’intérieur des groupes

### 9.5 IDs stables

* `reel_id = "reel_" + shortcode`
* `round_id = "r" + (index+1)`
* `item_id = "i_" + roundIndex + "_" + itemIndex`
* `sender_id` stable selon règle Setup (4.2)

---

## 10. Bouton principal — “Connecter les joueurs”

Position : sticky bas droite colonne gauche.

Conditions Enabled :

* `files.length >= 1`
* `activeSendersCount >= 2`

Action :

1. Filtre final :

   * senders actifs / non hidden / reel_count_total>0
   * reelItemsByUrl recalculé filtré (10A)
   * rounds[] générés (9)
2. Appel serveur `CREATE_ROOM` (WS) avec payload minimal :

   * `senders[]` (actifs seulement, id+name+reels_count)
   * `rounds[]` (round_id/items/reel/url/true_sender_ids)
   * `round_order[]`
3. Réponse `ROOM_CREATED` :

   * reçoit `code` + `master_key` + `players_visible`
4. Stockage local :

   * `draft.server_room = { code, master_key }` dans `localStorage.brp_draft_v1`
5. Navigation :

   * `/master/lobby` (le Lobby utilise `code` pour afficher QR + `master_key` pour actions master-only)

---

## 11. Réinitialiser ma room

Action :

1. Modal confirmation
2. Si `draft.server_room` existe :

   * envoyer `ROOM_CLOSED {code, master_key}`
3. Clear localStorage (`brp_draft_v1`)
4. Retour `/master`

---

## 12. Contraintes & Edge cases

* Parsing front uniquement
* Rebuild total si suppression fichier
* Fusion manuelle > auto
* Hidden senders exclus des stats
* Désactivation sender → recalcul instantané + re-génération rounds
* Pas de limite sur nombre de fichiers/senders (MVP)

---

## 13. Performance

* Parsing avec spinner global
* Optimisation :

  * normalisation en O(n)
  * Map pour dédup URL
  * Set en runtime pour reel_urls_set
* 10k–50k messages supportés (MVP acceptable)

---

## 14. États visuels

Sections verrouillées :

* Fusion → si < 2 fichiers
* Activation → si 0 fichier
* Connecter les joueurs → si < 2 senders actifs

---

## 15. Ce qui est figé à la sortie Setup

Au moment de “Connecter les joueurs”, le draft figé contient :

* senders actifs (après fusions/désactivations)
* reelItems globaux filtrés
* rounds[] générés (ordre stable seed)
* `seed`
* `server_room {code, master_key}` après création serveur

Aucune persistance en BDD.
La room serveur est en Redis (TTL 12h) et peut être fermée manuellement via “Réinitialiser ma room”.


