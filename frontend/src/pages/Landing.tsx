// frontend/src/pages/Landing.tsx
import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { createRoom } from "../lib/api";
import { saveMasterSession } from "../lib/storage";

export default function Landing() {
  const nav = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const qsErr = new URLSearchParams(loc.search).get("err");

  async function onCreate() {
    setErr("");
    setBusy(true);
    try {
      const res = await createRoom();
      saveMasterSession({ room_code: res.room_code, master_key: res.master_key });
      nav("/master/setup");
    } catch (e: any) {
      setErr(e?.message ?? "createRoom failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="h1">Brainrot Party</div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={onCreate}>
          {busy ? "Création..." : "Créer une partie"}
        </button>

        <button className="btn" onClick={() => nav("/play")}>
          Me connecter à une partie
        </button>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      {qsErr === "room_expired" ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,160,80,0.5)" }}>
          Room expiré.
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Flow</div>
        <div className="small">
          Master: Landing → Setup → “Connecter les joueurs” → Lobby (code visible).
          <br />
          Play: Landing → /play → entrer le code.
        </div>
      </div>
    </div>
  );
}
