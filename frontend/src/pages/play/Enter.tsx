import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { clearPlaySession, ensureDeviceId, loadPlaySession, savePlaySession } from "../../lib/storage";

export default function PlayEnter() {
  const nav = useNavigate();
  const existing = useMemo(() => loadPlaySession(), []);

  const [roomCode, setRoomCode] = useState(existing?.room_code ?? "");
  const [err, setErr] = useState("");

  const hasExisting = !!existing?.room_code && !!existing?.device_id;
  const isRejoin = hasExisting && roomCode.trim().toUpperCase() === existing!.room_code;

  function join() {
    setErr("");

    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setErr("Entre un code.");
      return;
    }

    const prev = loadPlaySession();
    let device_id = prev?.device_id ?? null;

    // Multi-room clean: if code changed, wipe session + new device id
    if (prev?.room_code && prev.room_code !== code) {
      clearPlaySession();
      device_id = ensureDeviceId(null);
    }

    // If no device_id yet, create one
    device_id = ensureDeviceId(device_id);

    savePlaySession({ room_code: code, device_id });
    nav("/play/lobby", { replace: true });
  }

  function reset() {
    clearPlaySession();
    setRoomCode("");
    setErr("");
  }

  return (
    <div className="card">
      <div className="h1">Play</div>

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="input mono"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          placeholder="CODE"
          style={{ width: 160, textTransform: "uppercase" }}
        />

        <button className="btn" onClick={join}>
          {isRejoin ? "REJOIN" : "JOIN"}
        </button>

        <button className="btn" onClick={reset}>
          RESET
        </button>
      </div>

      {err ? (
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      <div className="small" style={{ marginTop: 10, opacity: 0.85 }}>
        {hasExisting ? (
          <>
            Dernier code enregistré : <span className="mono">{existing!.room_code}</span>
          </>
        ) : (
          <>Aucun code enregistré.</>
        )}
      </div>
    </div>
  );
}
