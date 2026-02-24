# Brainrot Party — Invariants (non négociables)

Ce document définit les règles absolues du système. Si une implémentation contredit un invariant, l’implémentation est considérée comme incorrecte.

## 1) Autorité et source de vérité
- Le serveur est l’unique source de vérité pour :
  - la phase (`lobby` / `game` / `game_over`)
  - l’état des joueurs (actif/inactif, claim)
  - l’état de jeu (round, item courant, vote ouvert/fermé)
  - les votes
  - le scoring
- Le client n’est jamais autoritaire : il ne calcule pas de score “officiel”, ne valide pas de vote, et ne déduit pas une phase.
- Toute action client est une “demande” : le serveur peut refuser explicitement avec un code d’erreur.

## 2) Cycle de vie d’une room
- Toute room a un TTL. À expiration :
  - la room est considérée comme expirée et non récupérable ;
  - toute action renvoie `ROOM_EXPIRED` ;
  - la room peut être purgée (lazy) côté serveur.
- Un `room_code` expiré n’est pas réutilisable (pas de collision intentionnelle).

## 3) Identité device et claim joueur
- Chaque client Play possède un `device_id` persistant (localStorage).
- Un `device_id` ne peut contrôler qu’un seul `player` à la fois.
- Un `player` ne peut être “claim” que par un seul `device_id` à la fois.
- À reconnexion (même `device_id`) :
  - si `claimed_by` correspond et que le player existe encore, le serveur ré-associe le client à ce player ;
  - sinon, le client doit repasser par l’étape Choose.

## 4) Transitions de phase et validité des actions
- Seul le Master peut déclencher des transitions de phase (ex: `START_GAME`, progression globale).
- Toute action invalide par rapport à la phase ou l’état courant est refusée explicitement (pas d’ignore silencieux).
  - Exemple : `START_GAME` hors `lobby` → `INVALID_STATE`.
  - Exemple : action game alors que `phase=lobby` → `INVALID_STATE`.

## 5) Votes (règles strictes)
- Un vote est valide uniquement si TOUT est vrai :
  - `phase=game`
  - `round_id` correspond au round courant serveur
  - `item_id` correspond à l’item courant serveur
  - le votant est un `player` existant et `active=true`
- Vote hors fenêtre (vote fermé ou item terminé) :
  - refus explicite avec `VOTE_CLOSED`.
- Un player ne peut voter qu’une seule fois par item :
  - vote répété → `ALREADY_VOTED`.
- Un player inactif ne peut pas voter :
  - refus explicite avec `PLAYER_INACTIVE`.

## 6) Scoring
- Le scoring “officiel” est calculé uniquement côté serveur.
- Le scoring d’un item est figé au moment de la clôture de l’item (`END_ITEM`) (pas d’attribution progressive en temps réel).
- Le score total d’un player est toujours cohérent avec l’historique des rounds (pas de “correction client”).

## 7) Sync et résilience
- Toute mutation serveur de l’état Room déclenche un `STATE_SYNC` complet vers tous les clients connectés à la room.
- À toute connexion/reconnexion (`JOIN_ROOM`), le serveur renvoie immédiatement un `STATE_SYNC` complet et actuel.

## 8) Versioning protocole
- Le champ `protocol_version` est fourni uniquement dans `JOIN_ROOM`.
- Si `protocol_version` n’est pas supportée :
  - refus explicite avec `INVALID_PROTOCOL_VERSION`.

## 9) Sécurité minimale
- `master_key` est générée serveur à la création de room.
- `master_key` n’est jamais stockée en clair (hash côté Redis).
- `master_key` n’est jamais renvoyée après la création initiale.
- Un client Play ne peut pas exécuter d’actions réservées Master (ex: `START_GAME`) :
  - refus explicite avec `NOT_MASTER`.
- Les payloads entrants sont validés strictement :
  - si invalides → `INVALID_PAYLOAD` (pas de coercition silencieuse).
