import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearPlaySession, ensureDeviceId, loadPlaySession, savePlaySession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  phase: string;
  setup_ready: boolean;
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
  const didAutoConnectRef = useRef(false);

  useEffect(() => {
    return () => clientRef.current?.close();
  }, []);

  // Auto-reconnect if brp_play_v1 exists
  useEffect(() => {
    if (didAutoConnectRef.current) return;
    if (!existing?.room_code || !existing?.device_id) return;

    didAutoConnectRef.current = true;

    setRoomCode(existing.room_code);
    setDeviceId(existing.device_id);

    setTimeout(() => connect(existing.room_code, existing.device_id), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      const code = m.payload.error;
      const msg = String(m.payload.message ?? "");

      if (code === "room_expired" || code === "room_not_found") {
        clientRef.current?.close();
        clearPlaySession();
        setState(null);
        setStatus("disconnected");
        setErr(code === "room_expired" ? "Room expiré." : "Room introuvable.");
        return;
      }

      setErr(`${code}${msg ? `: ${msg}` : ""}`);
      return;
    }

    if (m.type === "SLOT_INVALIDATED") {
      setErr(
        m.payload.reason === "reset_by_master"
          ? "Slots reset par le master. Re-choisis un joueur."
          : "Ton slot a été invalidé. Re-choisis un joueur."
      );
      setRename("");
      // Deterministic: reflect invalidation immediately (no waiting for next sync)
      setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
      return;
    }

    if (m.type === "TAKE_PLAYER_FAIL") {
      const r = m.payload.reason;
      if (r === "setup_not_ready") setErr("Le master n’a pas encore publié le setup. Réessaie dans quelques secondes.");
      else if (r === "device_already_has_player") setErr("Tu as déjà un joueur sur ce device.");
      else if (r === "inactive") setErr("Ce joueur est désactivé.");
      else if (r === "player_not_found") setErr("Joueur introuvable.");
      else setErr("Slot déjà pris.");
      return;
    }

    if (m.type === "TAKE_PLAYER_OK") {
      setErr("");
      // state will be updated by next STATE_SYNC broadcast, but set immediately for UX determinism
      setState((prev) => (prev ? { ...prev, my_player_id: m.payload.my_player_id } : prev));
      return;
    }

    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setState({
        room_code: p.room_code,
        phase: p.phase,
        setup_ready: p.setup_ready,
        players: p.players_visible,
        my_player_id: p.my_player_id,
      });
      return;
    }
  }

  function connect(codeOverride?: string, deviceOverride?: string) {
    setErr("");

    const code = (codeOverride ?? roomCode).trim().toUpperCase();
    if (!code) {
      setErr("Entre un code.");
      return;
    }

    const prev = loadPlaySession();
    let joinDeviceId = deviceOverride ?? deviceId;

    if (prev?.room_code && prev.room_code !== code) {
      clearPlaySession();
      joinDeviceId = ensureDeviceId(null);
      setDeviceId(joinDeviceId);
      setState(null);
      setRename("");
    }

    savePlaySession({ room_code: code, device_id: joinDeviceId });

    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    setStatus("connecting");

    c.connectJoinRoom(
      { room_code: code, device_id: joinDeviceId },
      {
        onOpen: () => setStatus("open"),
        onClose: () => setStatus("closed"),
        onError: () => {
          setStatus("error");
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
        <button className="btn" onClick={() => connect()}>
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

          {!state.setup_ready ? (
            <div className="card">
              <div className="h2">En attente du setup</div>
              <div className="small">Le master prépare la partie. Réessaie dans quelques secondes.</div>
              <div style={{ height: 12 }} />
              <button className="btn" onClick={requestSync} disabled={status !== "open"}>
                Refresh
              </button>
            </div>
          ) : !state.my_player_id ? (
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
