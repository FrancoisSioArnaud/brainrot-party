# Brainrot Party — HTTP API (MVP)

Ce document décrit les endpoints HTTP utilisés dans le flux Master.

---

# 1. POST /room

Rôle  
Créer une nouvelle room.

Utilisé par  
Landing (bouton "Créer une nouvelle partie")

Request  
- Body : vide

Response (200)
{
  "room_code": "ABCD12",
  "master_key": "secret_master_key"
}

Effets backend
- Crée un state Redis minimal :
  {
    room_code,
    created_at,
    status: "setup",
    players: [],
    setup: null
  }
- Définit un TTL (ex: 24h)

Erreurs possibles
- 500 server_error

---

# 2. POST /room/:code/setup

Rôle  
Uploader le draft final dans une room existante.

Utilisé par  
/master/setup → bouton "Connecter les joueurs"

Auth  
- master_key requis
- Peut être envoyé via header ou body (à figer en implémentation)

Request (exemple)
{
  "protocol_version": "1",
  "seed": "abc123",
  "senders": [
    {
      "sender_id": "s1",
      "name": "Alice",
      "active": true,
      "reel_count": 12
    }
  ],
  "rounds": [
    {
      "round_id": "r1",
      "items": [
        {
          "reel_url": "...",
          "true_sender_ids": ["s1"]
        }
      ]
    }
  ],
  "round_order": ["r1","r2"]
}

Effets backend
- Vérifie room existante
- Vérifie master_key
- Valide cohérence payload
- Hydrate state.setup
- Passe room.status = "lobby_ready"

Response (200)
{
  "status": "ok"
}

Erreurs possibles
- 401 invalid_master_key
- 404 room_not_found
- 410 room_expired
- 400 validation_error

---

# 3. Gestion erreurs côté client

room_not_found / room_expired  
→ clear session master  
→ clear draft associé  
→ retour Landing avec message "Room expiré"

validation_error  
→ rester sur Setup  
→ afficher message clair

invalid_master_key  
→ clear session master  
→ retour Landing
