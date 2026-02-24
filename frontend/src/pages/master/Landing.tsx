import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../../lib/api";
import { loadMasterSession, saveMasterSession, clearMasterSession } from "../../lib/storage";

export default function MasterLanding() {
  const nav = useNavigate();
  const existing = useMemo(() => loadMasterSession(), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  async function onCreate() {
    setErr("");
    setBusy(true);
    try {
      const res = await createRoom();
      saveMasterSession({ room_code: res.room_code, master_key: res.master_key });
      nav("/master/lobby");
    } catch (e: any) {
      setErr(e?.message ?? "createRoom failed");
    } finally {
      setBusy(false);
    }
  }

  function onGoLobby() {
    if (!existing?.room_code || !existing?.master_key) {
      setErr("Pas de room existante. Crée une room d’abord.");
      return;
    }
    nav("/master/lobby");
  }

  function onReset() {
    clearMasterSession();
    setErr("");
  }

  return (
    <div className="card">
      <div className="h1">Master</div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" disabled={busy} onClick={onCreate}>
          {busy ? "Création..." : "Créer une room"}
        </button>
        <button className="btn" disabled={!existing?.room_code} onClick={onGoLobby}>
          Aller au lobby
        </button>
        <button className="btn" onClick={onReset}>
          Reset session
        </button>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Règle UX</div>
        <div className="small">
          Le code de room n’est affiché que dans le Lobby (c’est là que les joueurs se connectent).
        </div>
      </div>
    </div>
  );
}
