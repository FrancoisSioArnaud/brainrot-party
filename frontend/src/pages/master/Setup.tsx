import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { loadMasterSession } from "../../lib/storage";

export default function MasterSetup() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Setup</div>
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          Pas de session master. Reviens sur la landing et “Créer une partie”.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="h1">Master Setup</div>

      <div className="small">
        (Placeholder) Ici on configurera la partie (import JSON, senders, rounds…).
      </div>

      <div style={{ height: 12 }} />

      <button className="btn" onClick={() => nav("/master/lobby")}>
        Connecter les joueurs
      </button>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Note UX</div>
        <div className="small">
          Le code est déjà créé et stocké, mais il sera affiché uniquement dans le Lobby.
        </div>
      </div>
    </div>
  );
}
