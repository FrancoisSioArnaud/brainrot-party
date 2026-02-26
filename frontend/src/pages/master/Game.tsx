import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { PlayerAll, StateSyncRes } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearMasterSession, loadMasterSession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  phase: string;
  setup_ready: boolean;
  players_all: PlayerAll[] | null;
  game: any | null;
  scores: Record<string, number>;
};

export default function MasterGame() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);
  const clientRef = useRef<BrpWsClient | null>(null);

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ViewState | null>(null);

  // derived from STATE_SYNC.game (source of truth)
  const currentRoundId = (state?.game as any)?.item?.round_id ?? (state?.game as any)?.current_round_id ?? null;
  const currentItemId = (state?.game as any)?.item?.item_id ?? null;
  const currentReelUrl = (state?.game as any)?.item?.reel?.url ?? null;

  const status = (state?.game as any)?.status ?? "—";
  const votesReceived: string[] = (state?.game as any)?.votes_received_player_ids ?? [];
  const votedSet = useMemo(() => new Set(votesReceived), [votesReceived]);

  const lastVoteResults = (state?.game as any)?.current_vote_results ?? null;
  const isGameOver = state?.phase === "game_over" || status === "game_over";

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

  useEffect(() => {
    if (!state) return;
    if (state.phase === "lobby") nav("/master/lobby", { replace: true });
  }, [state?.phase, nav, state]);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      const msg = `${(m.payload as any).error}${(m.payload as any).message ? `: ${(m.payload as any).message}` : ""}`;
      setErr(msg);

      if ((m.payload as any).error === "room_expired" || (m.payload as any).error === "room_not_found") {
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
        game: (p as any).game ?? null,
        scores: p.scores ?? {},
      });
      return;
    }

    // server is source of truth; transient events only clear errors
    if (m.type === "GAME_START" || m.type === "NEW_ITEM" || m.type === "START_VOTE" || m.type === "VOTE_RESULTS" || m.type === "ROUND_RECAP" || m.type === "ROUND_FINISHED" || m.type === "GAME_OVER") {
      setErr("");
      return;
    }
  }

  function sendMsg(msg: any) {
    setErr("");
    clientRef.current?.send(msg);
  }

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Game (Master)</div>
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          Pas de session master.
        </div>
      </div>
    );
  }

  const phase = state?.phase ?? "—";
  const setupReady = state?.setup_ready ?? false;

  const players = (state?.players_all ?? []) as PlayerAll[];
  const scores = (state?.scores ?? {}) as Record<string, number>;

  const leaderboard = Object.entries(scores)
    .map(([player_id, score]) => ({
      player_id,
      score: typeof score === "number" ? score : 0,
      name: players.find((p) => p.player_id === player_id)?.name ?? player_id,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const canOpenVote = phase === "game" && status === "reveal" && !!currentRoundId && !!currentItemId;
  const canEndItem = phase === "game" && status === "reveal_wait" && !!currentRoundId && !!currentItemId;
  const canNextRound = phase === "game" && status === "round_recap";

  return (
    <div className="card">
      <div className="h1">Game (Master)</div>

      <div className="row" style={{ marginTop: 8 }}>
        <span className="badge ok">WS: {wsStatus}</span>
        <span className={setupReady ? "badge ok" : "badge warn"}>{setupReady ? "Setup OK" : "Setup missing"}</span>
        <span className="badge ok">phase: {phase}</span>
        <span className="badge ok">status: {status}</span>

        <button className="btn" onClick={() => sendMsg({ type: "REQUEST_SYNC", payload: {} })} disabled={wsStatus !== "open"}>
          Refresh
        </button>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      {phase === "game" && currentReelUrl ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Reel</div>
          <div style={{ marginTop: 10 }}>
            <iframe
              src={currentReelUrl}
              style={{ width: "100%", height: 520, border: "none" }}
              allow="autoplay; encrypted-media"
            />
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Contrôle</div>

        <div className="small mono" style={{ whiteSpace: "pre-line" }}>
          {`round_id: ${currentRoundId ?? "—"}
item_id: ${currentItemId ?? "—"}`}
        </div>

        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button
            className="btn"
            disabled={!canOpenVote}
            onClick={() => sendMsg({ type: "REEL_OPENED", payload: { round_id: currentRoundId!, item_id: currentItemId! } })}
          >
            Ouvrir vote
          </button>

          <button
            className="btn"
            disabled={!canEndItem}
            onClick={() => sendMsg({ type: "END_ITEM", payload: { round_id: currentRoundId!, item_id: currentItemId! } })}
          >
            Terminer item
          </button>

          <button className="btn" disabled={!canNextRound} onClick={() => sendMsg({ type: "START_NEXT_ROUND", payload: {} })}>
            Round suivant
          </button>
        </div>

        {lastVoteResults ? (
          <div className="small mono" style={{ marginTop: 10, whiteSpace: "pre-line", opacity: 0.9 }}>
            {`true_senders: ${(lastVoteResults.true_senders ?? []).join(", ")}`}
          </div>
        ) : null}
      </div>

      {phase === "game" && status === "vote" ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Votes</div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {players
              .filter((p) => p.active && p.claimed_by)
              .map((p) => {
                const voted = votedSet.has(p.player_id);
                return (
                  <div key={p.player_id} className="row" style={{ justifyContent: "space-between" }}>
                    <span className="mono">{p.name}</span>
                    <span className={voted ? "badge ok" : "badge warn"}>{voted ? "voted" : "…"}</span>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">{isGameOver ? "Classement final" : "Scores"}</div>

        {leaderboard.length === 0 ? (
          <div className="small">Aucun score.</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {leaderboard.map((r, i) => (
              <div key={r.player_id} className="row" style={{ justifyContent: "space-between" }}>
                <span className="mono">
                  {i + 1}. {r.name}
                </span>
                <span className="badge ok">{r.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
