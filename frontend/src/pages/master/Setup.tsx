// frontend/src/pages/master/Setup.tsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PROTOCOL_VERSION } from "@brp/contracts";
import { uploadRoomSetup } from "../../lib/api";
import { clearMasterSession, loadMasterSession } from "../../lib/storage";

export default function MasterSetup() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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

  async function onConnectPlayers() {
    setErr("");
    setBusy(true);
    try {
      // MVP placeholder payload (setup UI will fill this later)
      await uploadRoomSetup(session.room_code, session.master_key, {
        protocol_version: PROTOCOL_VERSION,
        seed: undefined,
        senders: [],
        rounds: [],
        round_order: [],
      });

      nav("/master/lobby");
    } catch (e: any) {
      const msg = String(e?.message ?? "upload failed");

      // Spec: room expired -> back to landing with a clear message
      if (msg.startsWith("room_expired") || msg.startsWith("room_not_found")) {
        clearMasterSession();
        nav("/?err=room_expired", { replace: true });
        return;
      }

      // Spec: draft corrupted stays on setup (draft not implemented yet, but keep same UX pattern)
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="h1">Master Setup</div>

      <div className="small">(Placeholder) Ici on configurera la partie (import JSON, senders, rounds…). </div>

      <div style={{ height: 12 }} />

      <button className="btn" disabled={busy} onClick={onConnectPlayers}>
        {busy ? "Envoi..." : "Connecter les joueurs"}
      </button>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Note UX</div>
        <div className="small">Le code est déjà créé et stocké, mais il sera affiché uniquement dans le Lobby.</div>
      </div>
    </div>
  );
}
