import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerAll, PlayerVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearMasterSession, loadMasterSession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  phase: string;
  players_visible: PlayerVisible[];
  players_all: PlayerAll[] | null;
  my_player_id: string | null;
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

    // Master: JOIN with master_key so server marks is_master=true and sends players_all
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
        players_visible: p.players_visible,
        players_all: p.players_all ?? null,
        my_player_id: p.my_player_id,
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

  function resetClaims() {
    clientRef.current?.send({ type: "RESET_CLAIMS", payload: {} });
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

  const list = state?.players_all ?? null;

  return (
    <div className="card">
      <div className="h1">Lobby (Master)</div>

      <div className="small">
        Room code: <span className="mono">{session.room_code}</span>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <span className="badge ok">WS: {wsStatus}</span>
        <button className="btn" onClick={requestSync} disabled={wsStatus !== "open"}>
          Refresh
        </button>
        <button className="btn" onClick={resetClaims} disabled={wsStatus !== "open"}>
          Reset claims
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
        ) : !list ? (
          <div className="small">
            Pas de players_all (tu n’es pas master ou master_key invalide). Vérifie le JOIN master_key.
          </div>
        ) : (
          <div className="list">
            {list.map((p) => {
              const status = p.claimed_by ? "taken" : "free";
              return (
                <div className="item" key={p.player_id}>
                  <div style={{ minWidth: 240 }}>
                    <div className="mono">{p.name}</div>
                    <div className="small mono">{p.player_id}</div>
                    <div className="small mono">claimed_by: {p.claimed_by ?? "—"}</div>
                  </div>

                  <div className="row" style={{ gap: 8 }}>
                    <span className={status === "taken" ? "badge warn" : "badge ok"}>{status}</span>
                    <label className="row" style={{ gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={p.active}
                        onChange={(e) => togglePlayer(p.player_id, e.target.checked)}
                      />
                      <span className="small">active</span>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
