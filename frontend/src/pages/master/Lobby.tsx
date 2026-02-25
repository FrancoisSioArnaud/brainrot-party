import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearMasterSession, loadMasterSession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  phase: string;
  players: PlayerVisible[];
};

export default function MasterLobby() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);
  const clientRef = useRef<BrpWsClient | null>(null);

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ViewState | null>(null);

  useEffect(() => {
    if (!session) return;

    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    setWsStatus("connecting");
    setErr("");

    // Master: JOIN_ROOM includes master_key
    c.connectJoinRoom(
      { room_code: session.room_code, device_id: "master_device", master_key: session.master_key },
      {
        onOpen: () => setWsStatus("open"),
        onClose: () => setWsStatus("closed"),
        onError: () => setWsStatus("error"),
        onMessage: (m) => onMsg(m),
      }
    );

    return () => c.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.room_code]);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      const msg = `${m.payload.error}${m.payload.message ? `: ${m.payload.message}` : ""}`;
      setErr(msg);

      if (m.payload.error === "room_expired" || m.payload.error === "room_not_found") {
        clearMasterSession();
        nav("/?err=room_expired", { replace: true });
      }
      return;
    }

    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setState({
        room_code: p.room_code,
        phase: p.phase,
        players: p.players_visible,
      });
    }
  }

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Master Lobby</div>
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          Pas de session master. Reviens sur la landing et “Créer une partie”.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="h1">Lobby</div>

      <div className="small">
        Room code: <span className="mono">{session.room_code}</span>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <span className="badge ok">WS: {wsStatus}</span>
        <button
          className="btn"
          onClick={() => clientRef.current?.send({ type: "REQUEST_SYNC", payload: {} })}
          disabled={wsStatus !== "open"}
        >
          REQUEST_SYNC
        </button>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Players</div>
        {!state ? (
          <div className="small">En attente de STATE_SYNC…</div>
        ) : (
          <div className="list">
            {state.players.map((p) => (
              <div className="item" key={p.player_id}>
                <div>
                  <div className="mono">{p.name}</div>
                  <div className="small mono">{p.player_id}</div>
                </div>
                <span className="badge ok">{p.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
