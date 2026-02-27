
# 📄 `docs/game_master_state_machine.md`

# Brainrot Party — Master/Game

## State Machine UI complète (version consolidée)

---

# 1. Vue globale

La page **Master/Game** alterne uniquement entre deux états racine :

* `ROUND_ACTIVE`
* `ROUND_SCORE_MODAL`

Il n’existe **pas** de phase `GAME_LOADING`.

La page Game n’est rendue que lorsque toutes les données nécessaires sont déjà disponibles.

`GAME_END` n’est pas un état distinct :
c’est un `ROUND_SCORE_MODAL` avec un affichage supplémentaire indiquant que tous les réels sont épuisés.

---

# 2. Round Active — Structure générale

Un round contient :

* `reels[]`
* `senders[]`
* `players[]`
* `votes_by_player`
* `K` pour chaque reel (nombre de senders associés)

Un reel est défini par :

* `url`
* `K` (slot count)
* `sender_ids[]`

---

# 3. Phase commune : WAITING

Il n’y a **pas de reel sélectionné par défaut**.

En phase `WAITING` :

* Tous les reels non encore révélés sont disponibles.
* Tous les boutons **“Voir le réel”** sont actifs.
* Le master peut choisir **n’importe quel reel**.
* Aucun reel n’est considéré comme “courant” tant qu’il n’a pas été ouvert.

Important :
Un reel déjà voté peut être rouvert :

* Cela ouvre l’URL dans un nouvel onglet.
* Cela ne déclenche ni vote, ni reveal.
* Aucun changement d’état.

---

# 4. Transition WAITING → VOTING

Event :
`MASTER_OPEN_REEL(reel_id)`

Effets :

* `window.open(url)`
* Si reel non encore voté :

  * Phase devient `VOTING`
  * `active_reel_id = reel_id`
* Si reel déjà voté :

  * Aucun changement de phase

---

# 5. Phase VOTING

État :

* `phase = VOTING`
* `active_reel_id` défini

UI :

* Bouton “Révéler le résultat” visible
* Les autres reels restent affichés
* Zone senders non révélés visible
* Players visibles

Règle :
Un reel ne peut être voté qu’une seule fois.

---

# 6. Transition VOTING → REVEAL

Event :
`MASTER_START_REVEAL`

Important :

* Le reveal est déclenché par le master.
* Les sous-étapes sont ensuite **100% locales au master**.
* Le serveur ne pilote pas les sous-étapes.

---

# 7. Phase REVEAL (séquencée automatiquement)

`phase = REVEAL`

Les sous-étapes sont exécutées automatiquement, sans interaction supplémentaire.

Ordre strict :

1. `REVEAL_VOTES`
2. `REVEAL_TRUE_SENDERS_EMPHASIS`
3. `REVEAL_MOVE_SENDERS_TO_SLOTS`
4. `REVEAL_VOTE_FEEDBACK`
5. `REVEAL_POINTS`
6. `REVEAL_CLEAR`

Chaque étape attend la fin de l’animation précédente.

---

## 7.1 REVEAL_VOTES

* Affichage des votes au-dessus de chaque player
* Nombre de cartes = `K` du reel

---

## 7.2 REVEAL_TRUE_SENDERS_EMPHASIS

* Les vrais senders grossissent à 200%
* Dans la zone senders non révélés

---

## 7.3 REVEAL_MOVE_SENDERS_TO_SLOTS

* Les senders disparaissent de la zone non révélés
* Ils apparaissent dans les slots du reel
* Mise à jour interne :

  * reel marqué comme voté
  * senders retirés de `unrevealed_senders`

---

## 7.4 REVEAL_VOTE_FEEDBACK

* Bons votes → bordure verte + grossissement
* Mauvais votes → bordure rouge + réduction

---

## 7.5 REVEAL_POINTS

* Score incrémenté
* Animation sur le texte score

---

## 7.6 REVEAL_CLEAR

* Disparition des cartes votes
* Retour à état neutre

Ensuite :

* `active_reel_id = null`
* `phase = WAITING`

---

# 8. Indication visuelle après Reveal

Après `REVEAL_CLEAR` :

Les boutons “Voir le réel” des reels non encore votés :

* Effectuent un **grossissement bref**
* Indiquent visuellement qu’il faut en choisir un autre

---

# 9. Passage en ROUND_SCORE_MODAL

Condition :

Tous les reels ont été votés.

Transition :
`ROUND_ACTIVE → ROUND_SCORE_MODAL`

---

# 10. ROUND_SCORE_MODAL

Affichage :

* Modale centrée
* Classement
* Scores
* Bouton “Round suivant”

Si dernier round :

* Message supplémentaire :
  “Tous les réels sont épuisés”

Transition :

* `MASTER_NEXT_ROUND`
* Retour `ROUND_ACTIVE`

---

# 11. Résumé State Machine simplifiée

```
ROUND_ACTIVE
    WAITING
        → MASTER_OPEN_REEL → VOTING
    VOTING
        → MASTER_START_REVEAL → REVEAL
    REVEAL (auto steps)
        → REVEAL_CLEAR → WAITING

ROUND_ACTIVE
    → (si tous votés) → ROUND_SCORE_MODAL
```

---

# 📄 `docs/game_master_layout.md`

# Brainrot Party — Master/Game

## Structure visuelle officielle

---

# 1. Contraintes générales

* Aucun scroll global
* Toute la page doit tenir en hauteur
* Reveal visuellement prioritaire
* Layout desktop first

---

# 2. Ordre vertical

1. Header
2. Grid des reels
3. Senders non révélés
4. Espace reveal
5. Players
6. Modale score (overlay)

---

# 3. Grid des Reels

* Max 4 cards par ligne
* Responsive
* Chaque card contient :

  * URL
  * Bouton “Voir le réel”
  * Slots (K)

Slots :

* Même forme que senders
* Légèrement plus grands
* Style pointillé
* Nombre = K (fourni par backend)

---

# 4. Senders non révélés

* Carrés à coins arrondis
* Tri alphabétique stable
* Image ou placeholder coloré
* Nom affiché dessous
* Disparaissent au reveal

---

# 5. Players

* Ronds
* Image ou placeholder coloré
* Nom dessous
* Score affiché sous le nom
* Espace au-dessus réservé aux votes

---

# 6. Couleurs

Définies au Start Game (fin lobby).

Règles :

* Sender sans image → couleur unique
* Player sans image → couleur unique
* Si player = sender → même couleur

---

# 7. Reveal — Animations obligatoires

* Votes apparaissent
* Vrais senders grossissent
* Déplacement vers slots
* Feedback votes
* Score animation
* Disparition votes
* Highlight boutons restants

---

# 8. Finalité UX

Le jeu doit paraître :

* Fluide
* Séquencé
* Compréhensible
* Dynamique
* Spectaculaire

---

