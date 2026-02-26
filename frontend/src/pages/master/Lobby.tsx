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

  // still used for debug counts + sender name lookup for bound players
  senders_visible: SenderVisible[];
  senders_all: SenderAll[] | null;
};

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
        onOpen: () => {
          // IMPORTANT: do NOT REQUEST_SYNC here.
          setWsStatus("open");
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
        senders_all: p.senders_all ?? null,
      });
      return;
    }
  }

  function requestSync() {
    setErr("");
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

  function openAddModal() {
    setErr("");
    setAddName("");
    setAddNameErr("");
    setAddModalOpen(true);
  }

  function closeAddModal() {
    setAddModalOpen(false);
    setAddNameErr("");
  }

  function confirmAddManualPlayer() {
    setErr("");
    const name = addName.trim();
    if (name.length < 1) {
      setAddNameErr("Nom requis");
      return;
    }
    if (name.length > 24) {
      setAddNameErr("24 caractères max");
      return;
    }

    clientRef.current?.send({ type: "ADD_PLAYER", payload: { name } });
    setAddModalOpen(false);
    setAddName("");
    setAddNameErr("");
  }

  function deleteManualPlayer(player_id: string) {
    setErr("");
    clientRef.current?.send({ type: "DELETE_PLAYER", payload: { player_id } });
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
  const lobbyWriteEnabled = wsStatus === "open" && phase === "lobby";

  function senderLabelFor(player: PlayerAll): string | null {
    if (!player.is_sender_bound) return null;
    if (!player.sender_id) return "créé à partir du sender (id manquant)";
    const s = state?.senders_all?.find((x) => x.sender_id === player.sender_id);
    if (s) return `créé à partir du sender ${s.name}`;
    return `créé à partir du sender ${player.sender_id}`;
  }

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

        <button
          className="btn"
          onClick={resetClaims}
          disabled={!resetEnabled}
          title={!resetEnabled ? "Setup/phase/WS not ready" : ""}
        >
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
            senders_all: <span className="mono">{state.senders_all?.length ?? "—"}</span>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Players</div>

        <div className="row" style={{ marginTop: 8, gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={openAddModal} disabled={!lobbyWriteEnabled}>
            Nouveau player
          </button>
          <span className="small">(lobby-only)</span>
        </div>

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
                      {senderLine ? (
                        <div className="small" style={{ opacity: 0.75 }}>
                          {senderLine}
                        </div>
                      ) : null}
                      <div className="small mono">claimed_by: {p.claimed_by ?? "—"}</div>
                    </div>
                  </div>

                  <div className="row" style={{ gap: 10 }}>
                    <span className={status === "taken" ? "badge warn" : "badge ok"}>{status}</span>

                    {/* Sender-bound: toggle only. Manual: delete only. */}
                    {p.is_sender_bound ? (
                      <label className="row" style={{ gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={p.active}
                          onChange={(e) => togglePlayer(p.player_id, e.target.checked)}
                          disabled={phase !== "lobby"}
                        />
                        <span className="small">active</span>
                      </label>
                    ) : (
                      <button
                        className="btn"
                        onClick={() => deleteManualPlayer(p.player_id)}
                        disabled={!lobbyWriteEnabled}
                        title="Delete manual player"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Danger</div>
        <button
          className="btn"
          onClick={() => {
            clearMasterSession();
            nav("/", { replace: true });
          }}
        >
          Quit (clear session)
        </button>
      </div>

      {/* Modal: Add Player */}
      {addModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Nouveau player"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddModal();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 420,
              boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="h2">Nouveau player</div>

            <div className="small" style={{ marginTop: 8 }}>
              Nom
            </div>

            <input
              className="input"
              value={addName}
              autoFocus
              onChange={(e) => {
                setAddName(e.target.value);
                if (addNameErr) setAddNameErr("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeAddModal();
                if (e.key === "Enter") confirmAddManualPlayer();
              }}
              placeholder="Ex: Léo"
              style={{ width: "100%", marginTop: 6 }}
            />

            {addNameErr ? (
              <div className="small" style={{ marginTop: 8, color: "rgba(255,80,80,0.95)" }}>
                {addNameErr}
              </div>
            ) : (
              <div className="small" style={{ marginTop: 8, opacity: 0.75 }}>
                1–24 caractères
              </div>
            )}

            <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={closeAddModal}>
                Annuler
              </button>
              <button className="btn" onClick={confirmAddManualPlayer} disabled={!lobbyWriteEnabled}>
                Valider
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
