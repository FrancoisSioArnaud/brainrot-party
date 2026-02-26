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

  const [editingName, setEditingName] = useState(false);
  const [rename, setRename] = useState("");
  const [renameErr, setRenameErr] = useState("");

  const clientRef = useRef<BrpWsClient | null>(null);

  useEffect(() => {
    return () => clientRef.current?.close();
  }, []);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setState({
        room_code: p.room_code,
        phase: p.phase,
        setup_ready: p.setup_ready,
        players: p.players_visible,
        my_player_id: p.my_player_id,
      });
    }
  }

  function releasePlayer() {
    setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
    clientRef.current?.send({ type: "RELEASE_PLAYER", payload: {} });
  }

  function submitRename() {
    const name = rename.trim();
    if (!name) {
      setRenameErr("Nom requis");
      return;
    }
    clientRef.current?.send({ type: "RENAME_PLAYER", payload: { new_name: name } });
    setEditingName(false);
  }

  const my =
    state?.my_player_id &&
    state.players.find((p) => p.player_id === state.my_player_id);

  return (
    <div className="card">
      <div className="h1">Play</div>

      {!state || !state.my_player_id ? (
        <div className="small">Sélectionner un joueur</div>
      ) : (
        <div className="card">
          {/* Bouton retour = changer de joueur */}
          <button className="btn" onClick={releasePlayer}>
            ← Retour
          </button>

          <div style={{ height: 16 }} />

          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: 999,
                overflow: "hidden",
                background: "rgba(255,255,255,0.06)",
                position: "relative",
                cursor: "pointer",
              }}
              onClick={() => {
                // ouvre caméra (logique déjà existante ailleurs)
              }}
            >
              {my?.avatar_url ? (
                <img
                  src={my.avatar_url}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}

              {/* icône photo */}
              <div
                style={{
                  position: "absolute",
                  bottom: 6,
                  right: 6,
                  fontSize: 14,
                }}
              >
                📷
              </div>
            </div>

            <div style={{ flex: 1 }}>
              {!editingName ? (
                <div
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                  onClick={() => {
                    setRename(my?.name ?? "");
                    setEditingName(true);
                  }}
                >
                  <span className="mono" style={{ fontSize: 20 }}>
                    {my?.name}
                  </span>
                  <span style={{ fontSize: 14 }}>✏️</span>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="input"
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                    autoFocus
                  />
                  <button className="btn" onClick={submitRename}>
                    OK
                  </button>
                </div>
              )}

              {renameErr ? (
                <div className="small" style={{ color: "rgba(255,80,80,0.9)" }}>
                  {renameErr}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
