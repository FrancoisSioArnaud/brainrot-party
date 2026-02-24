# Architecture Decisions Record (ADR)

Ce document centralise les décisions structurantes du projet Brainrot Party.

---

## ADR-001 — WebSocket unique par room

Décision  
Chaque room utilise un endpoint WebSocket unique basé sur le room_code.

Rationale  
- Simplifie l’isolation des rooms
- Permet un state Redis par room
- Évite le multiplexing complexe

---

## ADR-002 — Redis comme source de vérité runtime

Décision  
L’état runtime d’une room (players, claims, game state, scores, etc.) est stocké dans Redis.

Rationale  
- Accès rapide
- TTL natif
- Facilement invalidable
- Pas besoin de persistance long terme

---

## ADR-003 — Claims atomiques côté serveur

Décision  
La réservation d’un slot joueur (claim) est strictement atomique côté backend.

Rationale  
- Évite les doubles claims
- Anti-cheat minimal
- Source de vérité unique

---

## ADR-004 — Le backend est source de vérité scoring

Décision  
Le calcul des scores est exclusivement côté backend.

Rationale  
- Évite manipulation client
- Simplifie validation
- Sécurité minimale anti-cheat

---

## ADR-005 — Séparation création room / upload setup

Décision  

Nous séparons la création de room et l’envoi du setup final en deux endpoints distincts :

1) POST /room  
   - Crée une room vide
   - Génère room_code + master_key
   - Initialise un state minimal en Redis
   - Utilisé depuis la Landing

2) POST /room/:code/setup  
   - Authentifié via master_key
   - Reçoit le draft final (senders, rounds, round_order, seed, etc.)
   - Hydrate la room existante en Redis
   - Utilisé depuis Master Setup (bouton "Connecter les joueurs")

Rationale  

- Clarifie la responsabilité de chaque étape
- Permet d’obtenir un room_code immédiatement (affichage, partage)
- Évite de recréer une room si le draft est modifié
- Permet une validation serveur du setup avant passage en Lobby
- Supporte payload volumineuse uniquement sur l’endpoint setup

---

## ADR-006 — Un draft local est lié à un room_code

Décision  
Le draft local (brp_draft_v1) est strictement associé à un room_code.

Règles  
- Un draft d’un autre room_code ne doit jamais être réutilisé.
- Si la room expire → le draft associé est supprimé.
- Si le draft est corrompu → on reste sur Setup avec option reset.

Rationale  
- Évite incohérences entre room et setup
- Simplifie la logique de garde
