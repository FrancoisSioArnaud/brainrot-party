import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";

import { BrpWsClient } from "../../lib/wsClient";
import { createRoom } from "../../lib/api";
import { loadMasterSession, saveMasterSession } from "../../lib/storage";

export default function MasterLanding() {
  const nav = useNavigate();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const session = useMemo(() => loadMasterSession(), []);
  const clientRef = useRef<BrpWsClient | null>(null);

  useEffect(() => {
    return () => clientRef.current?.close();
  }, []);

  function onMsg(_m: ServerToClientMsg) {
    // Master landing does not need WS yet.
  }

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

  function onGoSetup() {
    nav("/master/setup");
  }

  function onGoLobby() {
    nav("/master/lobby");
  }

  // If you previously had a WS connect here, remove it. Master auth is via HTTP headers.
  // WS join (if used) is only room_code + device_id.
  function connectWsForDebug() {
    if (!session) return;
    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    c.connectJoinRoom(
      { room_code: session.room_code, device_id: "master_device" },
      {
        onOpen: () => {},
        onClose: () => {},
        onError: () => {},
        onMessage: (m) => onMsg(m),
      }
    );
  }

  return (
    <div className="card">
      <div className="h1">Master</div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={onCreate}>
          {busy ? "Création..." : "Créer une partie"}
        </button>

        <button className="btn" onClick={onGoSetup} disabled={!loadMasterSession()}>
          Ouvrir Setup
        </button>

        <button className="btn" onClick={onGoLobby} disabled={!loadMasterSession()}>
          Ouvrir Lobby
        </button>

        {/* Optional debug */}
        <button className="btn" onClick={connectWsForDebug} disabled={!loadMasterSession()}>
          WS Debug
        </button>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}
