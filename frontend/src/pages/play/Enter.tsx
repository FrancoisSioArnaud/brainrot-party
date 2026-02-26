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
  const [renameErr, setRenameErr] = useState("");
  const [lastTakeFail, setLastTakeFail] = useState<
    null | "setup_not_ready" | "device_already_has_player" | "inactive" | "player_not_found" | "taken_now"
  >(null);

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
      setRenameErr("");
      setLastTakeFail(null);
      setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
      return;
    }

    if (m.type === "TAKE_PLAYER_FAIL") {
      const r = m.payload.reason;
      setLastTakeFail(r === "taken_now" ? "taken_now" : (r as any));
      if (r === "setup_not_ready") setErr("Le master n’a pas encore publié le setup. Réessaie dans quelques secondes.");
      else if (r === "device_already_has_player") setErr("Tu as déjà un joueur sur ce device.");
      else if (r === "inactive") setErr("Ce joueur est désactivé.");
      else if (r === "player_not_found") setErr("Joueur introuvable.");
      else setErr("Slot déjà pris.");
      return;
    }

    if (m.type === "TAKE_PLAYER_OK") {
      setErr("");
      setLastTakeFail(null);
      setState((prev) => (prev ? { ...prev, my_player_id: m.payload.my_player_id } : prev));
      return;
    }

    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setLastTakeFail(null);
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
    setLastTakeFail(null);

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
      setRenameErr("");
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
    setRenameErr("");
    setLastTakeFail(null);
    clearPlaySession();
  }

  function requestSync() {
    clientRef.current?.send({ type: "REQUEST_SYNC", payload: {} });
  }

  function requestSyncAndClearErr() {
    setErr("");
    setLastTakeFail(null);
    requestSync();
  }

  function takePlayer(player_id: string) {
    setErr("");
    setLastTakeFail(null);
    clientRef.current?.send({ type: "TAKE_PLAYER", payload: { player_id } });
  }

  function releasePlayer() {
    setErr("");
    setLastTakeFail(null);
    // Optimistic UI: immediately return to list (WS will sync shortly)
    setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
    clientRef.current?.send({ type: "RELEASE_PLAYER", payload: {} });
  }

  function submitRename() {
    setErr("");
    setRenameErr("");
    const name = rename.trim();
    if (!name) {
      setRenameErr("Nom requis");
      return;
    }
    if (name.length > 24) {
      setRenameErr("24 caractères max");
      return;
    }
    clientRef.current?.send({ type: "RENAME_PLAYER", payload: { new_name: name } });
  }

  const my = state?.my_player_id ? state.players.find((p) => p.player_id === state.my_player_id) ?? null : null;
  const players = state?.players ?? [];
  const playersSorted = [...players].sort((a, b) => {
    if (a.status !== b.status) return a.status === "free" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const hasInvalidMyPlayer = !!state?.my_player_id && !my;

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

          {lastTakeFail === "device_already_has_player" ? (
            <div className="row" style={{ marginTop: 10, gap: 10 }}>
              <button className="btn" onClick={requestSyncAndClearErr} disabled={status !== "open"}>
                Voir mon joueur
              </button>
            </div>
          ) : null}
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
                {playersSorted.map((p) => {
                  const canTake = p.active && p.status === "free";
                  return (
                    <div className="item" key={p.player_id}>
                      <div>
                        <div className="row" style={{ gap: 10 }}>
                          <span className="mono">{p.name}</span>
                          <span className={p.status === "free" ? "badge ok" : "badge warn"}>{p.status}</span>
                        </div>
                        <div className="small mono">{p.player_id}</div>
                      </div>
                      <button className="btn" onClick={() => takePlayer(p.player_id)} disabled={!canTake}>
                        {p.status === "free" ? "Prendre" : "Pris"}
                      </button>
                    </div>
                  );
                })}
                {playersSorted.length === 0 ? <div className="small">Aucun joueur disponible.</div> : null}
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="h2">Mon joueur</div>
              {hasInvalidMyPlayer ? (
                <div className="card" style={{ borderColor: "rgba(255,180,0,0.45)" }}>
                  <div className="small">Ton slot n’existe plus (ou n’est plus visible). Re-choisis un joueur.</div>
                  <div style={{ height: 12 }} />
                  <div className="row" style={{ gap: 10 }}>
                    <button
                      className="btn"
                      onClick={() => {
                        setErr("Ton slot n’existe plus. Re-choisis un joueur.");
                        setLastTakeFail(null);
                        setRename("");
                        setRenameErr("");
                        setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
                        requestSync();
                      }}
                      disabled={status !== "open"}
                    >
                      Revenir à la liste
                    </button>
                    <button className="btn" onClick={requestSyncAndClearErr} disabled={status !== "open"}>
                      Refresh
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="mono" style={{ fontSize: 18 }}>
                      {my?.name ?? "—"}
                    </div>
                    <div className="small mono">{state.my_player_id}</div>
                  </div>
                  <span className="badge warn">taken</span>
                </div>
              )}

              <div style={{ height: 12 }} />

              <div className="row" style={{ gap: 10 }}>
                <button className="btn" onClick={releasePlayer} disabled={status !== "open"}>
                  Changer de joueur
                </button>
                <button className="btn" onClick={requestSync} disabled={status !== "open"}>
                  Refresh
                </button>
              </div>

              <div style={{ height: 12 }} />

              <div className="row">
                <input
                  className="input"
                  value={rename}
                  onChange={(e) => {
                    setRename(e.target.value);
                    if (renameErr) setRenameErr("");
                  }}
                  placeholder="Nouveau nom"
                  maxLength={24}
                />
                <button className="btn" onClick={submitRename}>
                  Renommer
                </button>
              </div>

              {renameErr ? (
                <div className="small" style={{ marginTop: 8, color: "rgba(255,80,80,0.95)" }}>
                  {renameErr}
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
