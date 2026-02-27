
### `brainrot_party_updated_specs/06-UI States (Master + Play).md`

(identique à ce que tu as demandé juste avant — recopie complète)


# 06 — UI States (Master + Play) — v4

---

# MASTER UI

---

## 1. MASTER — Lobby

### État : `lobby`

Affichage :

- Liste des players
- Liste des senders
- Activation / désactivation
- Reset claims
- Ajout / suppression player manuel
- Bouton `Start Game`

Règles :

- `Start Game` actif si :
  - ≥ 2 players actifs
  - tous les players actifs sont claimés
  - setup_ready = true

---

## 2. MASTER — Game (Round Active)

Vue : `round_active`

Sous-phases :
- `waiting`
- `voting`

Reveal = animations locales (non pilotées serveur)

---

# 2.1 WAITING

### État serveur

```ts
view = "round_active"
phase = "waiting"
active_item_id = null
````

### UI

* Grid de reels (cards)
* Chaque card contient :

  * URL brute
  * Slots (K)
  * Bouton "Voir le réel"
* Tous les items `pending` ont bouton actif
* Items `voted` ont slots remplis
* Zone senders non révélés :

  * carrés arrondis
  * tri alphabétique (côté client)
* Players en bas (ronds + score)

### Règles

* Master peut cliquer n’importe quel item `pending`
* Si item `voted` → ouvrir URL en local uniquement (no-op serveur)

Transition :
`OPEN_ITEM` → `voting`

---

# 2.2 VOTING

### État serveur

```ts
view = "round_active"
phase = "voting"
active_item_id = item_id
```

### UI Master

* Card du reel actif en état "voting"
* Bouton "Révéler le résultat"
* Bouton "Forcer la fermeture (10s)"
* Indicateur players ayant voté
* Autres cards visibles mais non interactives pour vote

### UI Play

* Affiche senders sélectionnables
* Limite sélection : 0..K
* Bouton "Valider"

### Fin de vote

Vote se ferme :

1. Automatiquement si tous les players ont voté
2. Ou après countdown 10s si forcé

Transition serveur :

* calcul résultats
* mise à jour scores
* item.status = voted
* phase → waiting
* active_item_id = null

Émissions :

* `VOTE_RESULTS`
* `ITEM_VOTED`

---

# 2.3 REVEAL (Master uniquement)

Le reveal est 100% local au Master.

Sous-étapes séquencées automatiquement :

---

### 1. Reveal votes

* Cartes au-dessus des players
* Nombre = sélections envoyées (0..K)

---

### 2. Emphase vrais senders

* Senders corrects grossissent à 200%
* Toujours dans la zone non révélée

---

### 3. Move to slots

* Disparition de la zone non révélée
* Apparition dans slots de la card
* item.status visuellement confirmé

---

### 4. Feedback votes

* Bons votes → bordure verte + scale up
* Mauvais votes → bordure rouge + scale down

---

### 5. Points animation

* Score sous player incrémenté
* Animation grossissement texte

---

### 6. Clear

* Disparition cartes votes
* Retour état neutre

---

### Après Reveal

* Les boutons des items `pending` font un bref grossissement
* Invite visuelle à choisir un nouveau reel

---

# 3. MASTER — Round Score Modal

Vue : `round_score_modal`

Affichage :

* Modale centrée
* Classement
* Scores
* Bouton "Round suivant"

Si dernier round :

* message supplémentaire : "Tous les réels sont épuisés"

---

# PLAY UI

---

## 1. PLAY — Lobby

* Liste players disponibles
* Claim slot
* Rename
* Avatar
* Indication si setup non prêt

---

## 2. PLAY — Waiting (Game)

Phase serveur :

* `round_active`
* `phase = waiting`

UI :

* Message "En attente du prochain reel"
* Score visible
* Aucun contrôle

---

## 3. PLAY — Voting

Phase serveur :

* `round_active`
* `phase = voting`

UI :

* Liste senders sélectionnables
* Limite sélection : 0..K
* Bouton valider
* Indication countdown si force close actif

---

## 4. PLAY — After Vote

* Vote envoyé
* Message "Vote enregistré"
* Puis retour état attente

Les players regardent l’écran Master pour le reveal.

---

# RÈGLES GLOBALES

---

## Couleurs

Assignées au `START_GAME` :

* Persistées côté serveur
* Envoyées dans sync
* Si player = sender lié sans avatar → même couleur

---

## Tri senders non révélés

* Tri alpha côté client
* Stable

---

## Vote

* 0..K sélections
* Si >K → tronqué serveur
* +1 point par sender correct
* Pas de pénalité

---

## Fin de round

* Tous items `voted`
* Serveur pousse `ROUND_SCORE_MODAL`

---

## Fin de game

* Dernier round terminé
* `ROUND_SCORE_MODAL` avec `game_over=true`
* Pas d’état distinct supplémentaire

```

---

Si tu veux enchaîner direct étape 2 (compilation contracts) : colle-moi la sortie de `npm -w contracts run build` (ou ton script équivalent) et je corrige les imports/typos éventuelles en te redonnant les fichiers complets corrigés.
```
