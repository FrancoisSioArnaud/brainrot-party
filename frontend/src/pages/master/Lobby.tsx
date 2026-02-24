import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { loadMasterSession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  players: PlayerVisible[];
  phase: string;
};

export default function MasterLobby() {
  const session = useMemo(() => loadMasterSession(), []);
  const [status, setStatus] = useState<string>("disconnected");
  const [err, setErr] = useState<string>("");
  const [state, setState] = useState<ViewState | null>(null);

  const clientRef = useRef<BrpWsClient | null>(null);

  useEffect(() => {
    if (!session) {
      setErr("Pas de session master. Va sur /master et crée une room.");
      return;
    }

    const c = new BrpWsClient();
    clientRef.current = c;

    setErr("");
    setStatus("connecting");

    c.connectJoinRoom(
      { room_code: session.room_code, device_id: "master_device", master_key: session.master_key },
      {
        onOpen: () => setStatus("open"),
        onClose: () => setStatus("closed"),
        onError: () => setStatus("error"),
        onMessage: (m) => onMsg(m),
      }
    );

    return () => c.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.room_code]);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      setErr(`${m.payload.error}${m.payload.message ? `: ${m.payload.message}` : ""}`);
      return;
    }
    if (m.type === "JOIN_OK") return;
    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setState({
        room_code: p.room_code,
        phase: p.phase,
        players: p.players_visible,
      });
      return;
    }
  }

  function requestSync() {
    clientRef.current?.send({ type: "REQUEST_SYNC", payload: {} });
  }

  function togglePlayer(player_id: string, active: boolean) {
    clientRef.current?.send({ type: "TOGGLE_PLAYER", payload: { player_id, active } });
  }

  return (
    <div className="card">
      <div className="h1">Master Lobby</div>

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="badge ok">WS: {status}</div>
        <button className="btn" onClick={requestSync}>REQUEST_SYNC</button>
      </div>

      {err ? <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)", marginBottom: 12 }}>{err}</div> : null}

      {!state ? (
        <div className="small">En attente de STATE_SYNC_RESPONSE…</div>
      ) : (
        <>
          <div className="small">
            Room: <span className="mono">{state.room_code}</span> — Phase: <span className="mono">{state.phase}</span>
          </div>

          <div style={{ height: 12 }} />

          <div className="list">
            {state.players.map((p) => (
              <div className="item" key={p.player_id}>
                <div>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="mono">{p.name}</span>
                    <span className={`badge ${p.active ? "ok" : "bad"}`}>{p.active ? "active" : "inactive"}</span>
                    <span className={`badge ${p.status === "free" ? "ok" : "warn"}`}>{p.status}</span>
                  </div>
                  <div className="small mono">{p.player_id}</div>
                </div>

                <div className="row">
                  <button
                    className="btn"
                    onClick={() => togglePlayer(p.player_id, !p.active)}
                  >
                    {p.active ? "Désactiver" : "Activer"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
