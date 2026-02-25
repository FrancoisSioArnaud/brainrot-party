import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearPlaySession, ensureDeviceId, loadPlaySession, savePlaySession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  phase: string;
  players: PlayerVisible[];
  my_player_id: string | null;
};

export default function PlayEnter() {
  const existing = useMemo(() => loadPlaySession(), []);
  const [roomCode, setRoomCode] = useState(existing?.room_code ?? "");
  const [deviceId, setDeviceId] = useState(ensureDeviceId(existing?.device_id ?? null));

  const [status, setStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ViewState | null>(null);

  const [rename, setRename] = useState("");

  const clientRef = useRef<BrpWsClient | null>(null);

  // Keep the last server ERROR (if any) to show why we closed
  const lastServerErrorRef = useRef<{ error: string; message?: string } | null>(null);

  useEffect(() => {
    return () => clientRef.current?.close();
  }, []);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      lastServerErrorRef.current = { error: m.payload.error, message: m.payload.message };
      const e = `${m.payload.error}${m.payload.message ? `: ${m.payload.message}` : ""}`;
      setErr(e);
      return;
    }

    if (m.type === "SLOT_INVALIDATED") {
      setErr("Ton slot a été invalidé. Re-choisis un joueur.");
      setRename("");
      return;
    }

    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setState({
        room_code: p.room_code,
        phase: p.phase,
        players: p.players_visible,
        my_player_id: p.my_player_id,
      });
      return;
    }
  }

  function connect() {
    setErr("");
    lastServerErrorRef.current = null;

    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setErr("Entre un code.");
      return;
    }

    // Multi-room: purge si changement de code
    const prev = loadPlaySession();
    let joinDeviceId = deviceId;
    if (prev?.room_code && prev.room_code !== code) {
      clearPlaySession();
      joinDeviceId = ensureDeviceId(null);
      setDeviceId(joinDeviceId);
    }

    savePlaySession({ room_code: code, device_id: joinDeviceId });

    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    setStatus("connecting");

    c.connectJoinRoom(
      { room_code: code, device_id: joinDeviceId },
      {
        onOpen: () => {
          setStatus("open");
        },
        onClose: (ev) => {
          setStatus("closed");

          // Console diagnostics (the real payload you need)
          const lastErr = lastServerErrorRef.current;
          console.log("[Play] WS closed", {
            close_code: ev.code,
            close_reason: ev.reason,
            wasClean: ev.wasClean,
            last_server_error: lastErr,
          });

          // UI: simple message, but if we have a server ERROR, show it (still simple)
          if (lastErr) {
            setErr(lastErr.message ? lastErr.message : `Connexion refusée (${lastErr.error}).`);
            return;
          }

          // Map most common close codes to simple user-facing messages
          if (ev.code === 1006) {
            setErr("Connexion impossible. Problème réseau/proxy (WS).");
            return;
          }
          if (ev.code === 1008) {
            setErr("Connexion refusée.");
            return;
          }
          if (ev.code === 1011) {
            setErr("Erreur serveur pendant la connexion.");
            return;
          }

          setErr("Connexion impossible.");
        },
        onError: (ev) => {
          setStatus("error");
          console.log("[Play] WS error event", ev);
          // UI simple
          setErr("Connexion impossible.");
        },
        onMessage: (m) => onMsg(m),
      }
    );
  }

  function disconnect() {
    clientRef.current?.close();
    setStatus("disconnected");
    setState(null);
    setErr("");
    setRename("");
    lastServerErrorRef.current = null;
    clearPlaySession();
  }

  function requestSync() {
    clientRef.current?.send({ type: "REQUEST_SYNC", payload: {} });
  }

  function takePlayer(player_id: string) {
    setErr("");
    clientRef.current?.send({ type: "TAKE_PLAYER", payload: { player_id } });
  }

  function submitRename() {
    setErr("");
    const name = rename.trim();
    if (!name) return;
    clientRef.current?.send({ type: "RENAME_PLAYER", payload: { new_name: name } });
  }

  const my = state?.my_player_id ? state.players.find((p) => p.player_id === state.my_player_id) ?? null : null;
  const freePlayers = (state?.players ?? []).filter((p) => p.active && p.status === "free");

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
        <button className="btn" onClick={connect}>
          JOIN
        </button>
        <button className="btn" onClick={disconnect}>
          RESET
        </button>
        <button className="btn" onClick={requestSync} disabled={status !== "open"}>
          REQUEST_SYNC
        </button>
        <span className="badge ok">WS: {status}</span>
      </div>

      <div className="small">
        device_id: <span className="mono">{deviceId}</span>
      </div>

      {err ? (
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)", marginTop: 12 }}>
          {err}
        </div>
      ) : null}

      <div style={{ height: 12 }} />

      {!state ? (
        <div className="small">Connecte-toi avec un code pour recevoir STATE_SYNC_RESPONSE…</div>
      ) : (
        <>
          <div className="small">
            Room: <span className="mono">{state.room_code}</span> — Phase: <span className="mono">{state.phase}</span>
          </div>

          <div style={{ height: 12 }} />

          {!state.my_player_id ? (
            <div className="card">
              <div className="h2">Choisir un joueur</div>
              <div className="list">
                {freePlayers.map((p) => (
                  <div className="item" key={p.player_id}>
                    <div>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="mono">{p.name}</span>
                        <span className="badge ok">free</span>
                      </div>
                      <div className="small mono">{p.player_id}</div>
                    </div>
                    <button className="btn" onClick={() => takePlayer(p.player_id)}>
                      Prendre
                    </button>
                  </div>
                ))}
                {freePlayers.length === 0 ? <div className="small">Aucun slot libre.</div> : null}
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="h2">Mon joueur</div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="mono" style={{ fontSize: 18 }}>
                    {my?.name ?? "—"}
                  </div>
                  <div className="small mono">{state.my_player_id}</div>
                </div>
                <span className="badge warn">taken</span>
              </div>

              <div style={{ height: 12 }} />

              <div className="row">
                <input
                  className="input"
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                  placeholder="Nouveau nom"
                  maxLength={24}
                />
                <button className="btn" onClick={submitRename}>
                  Renommer
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
