import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerAll, SenderVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearMasterSession, loadMasterSession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  phase: string;
  setup_ready: boolean;
  players_all: PlayerAll[] | null;
  senders_visible: SenderVisible[];
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

    c.connectJoinRoom(
      { room_code: session.room_code, device_id: "master_device", master_key: session.master_key },
      {
        onOpen: () => {
          setWsStatus("open");
          c.send({ type: "REQUEST_SYNC", payload: {} });
        },
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
        setup_ready: p.setup_ready,
        players_all: p.players_all ?? null,
        senders_visible: p.senders_visible ?? [],
      });
      return;
    }
  }

  function requestSync() {
    clientRef.current?.send({ type: "REQUEST_SYNC", payload: {} });
  }

  function togglePlayer(player_id: string, active: boolean) {
    setErr("");
    clientRef.current?.send({ type: "TOGGLE_PLAYER", payload: { player_id, active } });
  }

  function resetClaims() {
    setErr("");
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

  const setupReady = state?.setup_ready ?? false;
  const phase = state?.phase ?? "—";

  const players = state?.players_all ?? [];
  const playersActive = players.filter((p) => p.active).length;
  const playersTaken = players.filter((p) => !!p.claimed_by).length;
  const playersFree = players.length - playersTaken;

  const resetEnabled = wsStatus === "open" && setupReady && phase === "lobby";

  return (
    <div className="card">
      <div className="h1">Lobby (Master)</div>

      <div className="small">
        Room code: <span className="mono">{session.room_code}</span>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <span className="badge ok">WS: {wsStatus}</span>
        <span className={setupReady ? "badge ok" : "badge warn"}>
          {setupReady ? "Setup OK" : "Setup missing"}
        </span>
        <span className="badge ok">phase: {phase}</span>

        <button className="btn" onClick={requestSync} disabled={wsStatus !== "open"}>
          Refresh
        </button>

        <button className="btn" onClick={resetClaims} disabled={!resetEnabled} title={!resetEnabled ? "Setup/phase/WS not ready" : ""}>
          Reset claims
        </button>

        {!setupReady ? (
          <button className="btn" onClick={() => nav("/master/setup")}>
            Retour Setup
          </button>
        ) : null}
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Debug</div>
        {!state ? (
          <div className="small">En attente de STATE_SYNC…</div>
        ) : (
          <div className="small">
            setup_ready: <span className="mono">{String(setupReady)}</span>
            {" · "}
            players_all: <span className="mono">{players.length}</span>
            {" · "}
            active: <span className="mono">{playersActive}</span>
            {" · "}
            free/taken: <span className="mono">{playersFree}</span>/<span className="mono">{playersTaken}</span>
            {" · "}
            senders_visible(active): <span className="mono">{state.senders_visible.length}</span>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Players</div>

        {!state ? (
          <div className="small">En attente de STATE_SYNC…</div>
        ) : !state.players_all ? (
          <div className="small">players_all manquant (JOIN master_key invalide ?)</div>
        ) : state.players_all.length === 0 ? (
          <div className="small">
            {setupReady ? "Aucun player (état incohérent)." : "Aucun player (setup non publié)."}
          </div>
        ) : (
          <div className="list">
            {state.players_all.map((p) => {
              const status = p.claimed_by ? "taken" : "free";
              const initials = (p.name || "?")
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((x) => x[0]?.toUpperCase())
                .join("");

              return (
                <div className="item" key={p.player_id}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 260 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 999,
                        overflow: "hidden",
                        background: "rgba(255,255,255,0.06)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "0 0 auto",
                      }}
                      title={p.avatar_url ?? ""}
                    >
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <span className="mono" style={{ fontSize: 14, opacity: 0.9 }}>
                          {initials || "?"}
                        </span>
                      )}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div className="mono">{p.name}</div>
                      <div className="small mono">{p.player_id}</div>
                      <div className="small mono">claimed_by: {p.claimed_by ?? "—"}</div>
                    </div>
                  </div>

                  <div className="row" style={{ gap: 10 }}>
                    <span className={status === "taken" ? "badge warn" : "badge ok"}>{status}</span>
                    <label className="row" style={{ gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={p.active}
                        onChange={(e) => togglePlayer(p.player_id, e.target.checked)}
                        disabled={phase !== "lobby"}
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

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Senders (active)</div>
        {!state ? (
          <div className="small">—</div>
        ) : state.senders_visible.length === 0 ? (
          <div className="small">{setupReady ? "Aucun sender actif." : "Setup non publié."}</div>
        ) : (
          <div className="list">
            {state.senders_visible.map((s) => (
              <div className="item" key={s.sender_id}>
                <div>
                  <div className="mono">{s.name}</div>
                  <div className="small mono">{s.sender_id}</div>
                </div>
                <span className="badge ok">reels: {s.reels_count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
