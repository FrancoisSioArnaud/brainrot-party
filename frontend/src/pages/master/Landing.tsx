import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../../lib/api";
import { loadMasterSession, saveMasterSession } from "../../lib/storage";

export default function MasterLanding() {
  const nav = useNavigate();
  const existing = useMemo(() => loadMasterSession(), []);
  const [busy, setBusy] = useState(false);
  const [roomCode, setRoomCode] = useState(existing?.room_code ?? "");
  const [err, setErr] = useState<string>("");

  async function onCreate() {
    setErr("");
    setBusy(true);
    try {
      const res = await createRoom();
      saveMasterSession({ room_code: res.room_code, master_key: res.master_key });
      setRoomCode(res.room_code);
    } catch (e: any) {
      setErr(e?.message ?? "createRoom failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="h1">Master</div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" disabled={busy} onClick={onCreate}>
          {busy ? "Création..." : "Créer une room"}
        </button>
        <button className="btn" disabled={!roomCode} onClick={() => nav("/master/lobby")}>
          Aller au lobby
        </button>
      </div>

      <div className="small">Room code</div>
      <div className="mono" style={{ fontSize: 22, marginTop: 6 }}>{roomCode || "—"}</div>

      {err ? <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>{err}</div> : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Test rapide</div>
        <div className="small">
          Ouvre /play sur un autre device, entre le code, prends un slot, renomme, puis toggle depuis Master Lobby.
        </div>
      </div>
    </div>
  );
}
