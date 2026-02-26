import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerAll, SenderAll, SenderVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearMasterSession, loadMasterSession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  phase: string;
  setup_ready: boolean;
  players_all: PlayerAll[] | null;
  senders_visible: SenderVisible[];
  senders_all: SenderAll[] | null;
};

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function makeUniqueName(base: string, existing: string[]): string {
  const baseNorm = normalizeName(base);
  const existingSet = new Set(existing.map((n) => normalizeName(n).toLowerCase()));
  if (!existingSet.has(baseNorm.toLowerCase())) return baseNorm;

  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseNorm} ${i}`;
    if (!existingSet.has(candidate.toLowerCase())) return candidate;
  }
  return `${baseNorm} ${Date.now()}`;
}

export default function MasterLobby() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);
  const clientRef = useRef<BrpWsClient | null>(null);

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ViewState | null>(null);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addNameErr, setAddNameErr] = useState("");

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
        setup_ready: p.setup_ready,
        players_all: p.players_all ?? null,
        senders_visible: p.senders_visible ?? [],
        senders_all: p.senders_all ?? null,
      });
      return;
    }
  }

  function togglePlayer(player_id: string, active: boolean) {
    clientRef.current?.send({ type: "TOGGLE_PLAYER", payload: { player_id, active } });
  }

  function resetClaims() {
    clientRef.current?.send({ type: "RESET_CLAIMS", payload: {} });
  }

  function openAddModal() {
    setAddName("");
    setAddNameErr("");
    setAddModalOpen(true);
  }

  function closeAddModal() {
    setAddModalOpen(false);
    setAddNameErr("");
  }

  function confirmAddManualPlayer() {
    const raw = normalizeName(addName);
    if (raw.length < 1) {
      setAddNameErr("Nom requis");
      return;
    }
    if (raw.length > 24) {
      setAddNameErr("24 caractères max");
      return;
    }

    const existingNames = (state?.players_all ?? []).map((p) => p.name);
    const unique = makeUniqueName(raw, existingNames);

    if (unique.length > 24) {
      setAddNameErr("Nom trop long après suffixe (24 max)");
      return;
    }

    clientRef.current?.send({ type: "ADD_PLAYER", payload: { name: unique } });
    closeAddModal();
  }

  function deleteManualPlayer(player_id: string) {
    clientRef.current?.send({ type: "DELETE_PLAYER", payload: { player_id } });
  }

  function senderLabelFor(player: PlayerAll): string | null {
    if (!player.is_sender_bound) return null;
    if (!player.sender_id) return "créé à partir du sender (id manquant)";
    const s = state?.senders_all?.find((x) => x.sender_id === player.sender_id);
    return s ? `créé à partir du sender ${s.name}` : `créé à partir du sender ${player.sender_id}`;
  }

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Master Lobby</div>
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          Pas de session master.
        </div>
      </div>
    );
  }

  const players = state?.players_all ?? [];
  const phase = state?.phase ?? "—";
  const lobbyWriteEnabled = wsStatus === "open" && phase === "lobby";

  return (
    <div className="card">
      <div className="h1">Lobby (Master)</div>

      <div className="small">
        Room code: <span className="mono">{session.room_code}</span>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <span className="badge ok">WS: {wsStatus}</span>
        <button className="btn" onClick={resetClaims} disabled={!lobbyWriteEnabled}>
          Reset claims
        </button>
      </div>

      {err && (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Players</div>

        {!state ? (
          <div className="small">En attente de STATE_SYNC…</div>
        ) : (
          <>
            <div className="list">
              {players.map((p) => {
                const status = p.claimed_by ? "taken" : "free";
                const senderLine = senderLabelFor(p);

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
                        }}
                      >
                        {p.avatar_url && (
                          <img src={p.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        )}
                      </div>

                      <div>
                        <div className="mono">{p.name}</div>
                        {senderLine && <div className="small">{senderLine}</div>}
                        <div className="small mono">{p.player_id}</div>
                      </div>
                    </div>

                    <div className="row" style={{ gap: 10 }}>
                      <span className={status === "taken" ? "badge warn" : "badge ok"}>{status}</span>

                      {p.is_sender_bound ? (
                        <label className="row" style={{ gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={p.active}
                            onChange={(e) => togglePlayer(p.player_id, e.target.checked)}
                            disabled={!lobbyWriteEnabled}
                          />
                          <span className="small">active</span>
                        </label>
                      ) : (
                        <button
                          className="btn"
                          onClick={() => deleteManualPlayer(p.player_id)}
                          disabled={!lobbyWriteEnabled}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* bouton déplacé en bas */}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={openAddModal} disabled={!lobbyWriteEnabled}>
                Nouveau player
              </button>
            </div>
          </>
        )}
      </div>

      {/* senders grid 4 colonnes */}
      {state?.senders_all && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Senders</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginTop: 8,
            }}
          >
            {state.senders_all.map((s) => (
              <div key={s.sender_id} className="card">
                <div className="mono">{s.name}</div>
                <div className="small mono">{s.sender_id}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {addModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div className="card" style={{ maxWidth: 420, width: "100%" }}>
            <div className="h2">Nouveau player</div>
            <input
              className="input"
              value={addName}
              autoFocus
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Nom"
            />
            {addNameErr && <div className="small" style={{ color: "red" }}>{addNameErr}</div>}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={closeAddModal}>Annuler</button>
              <button className="btn" onClick={confirmAddManualPlayer}>Valider</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
