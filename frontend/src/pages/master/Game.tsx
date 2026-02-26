import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearMasterSession, loadMasterSession } from "../../lib/storage";

type VoteResults = {
  round_id: string;
  item_id: string;
  votes: Record<string, string[]>;
  true_sender_ids: string[];
  scores: Record<string, number>;
};

type ViewState = {
  room_code: string;
  phase: string;
  setup_ready: boolean;
  players_all: any[] | null;
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

  const [currentRoundId, setCurrentRoundId] = useState<string | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);

  const [votedSet, setVotedSet] = useState<Set<string>>(new Set());
  const [lastResults, setLastResults] = useState<VoteResults | null>(null);
  const [lastRecapRoundId, setLastRecapRoundId] = useState<string | null>(null);

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
  }, [state?.phase, nav]);

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
        players_all: (p.players_all as any) ?? null,
        game: (p as any).game ?? null,
        scores: p.scores ?? {},
      });
      return;
    }

    if (m.type === "GAME_START") {
      setErr("");
      setVotedSet(new Set());
      setLastResults(null);
      setLastRecapRoundId(null);
      return;
    }

    if (m.type === "NEW_ITEM") {
      setErr("");
      setCurrentRoundId(m.payload.round_id);
      setCurrentItemId(m.payload.item_id);
      setVotedSet(new Set());
      setLastResults(null);
      setLastRecapRoundId(null);
      return;
    }

    if (m.type === "START_VOTE") {
      setErr("");
      setVotedSet(new Set());
      return;
    }

    if (m.type === "PLAYER_VOTED") {
      setVotedSet((prev) => {
        const n = new Set(prev);
        n.add(m.payload.player_id);
        return n;
      });
      return;
    }

    if (m.type === "VOTE_RESULTS") {
      setLastResults({
        round_id: m.payload.round_id,
        item_id: m.payload.item_id,
        votes: m.payload.votes,
        true_sender_ids: m.payload.true_sender_ids,
        scores: m.payload.scores,
      });
      return;
    }

    if (m.type === "ROUND_RECAP") {
      setLastRecapRoundId(m.payload.round_id);
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

  const game = state?.game as any;
  const status = game?.status ?? "—";
  const roundFinished = !!game?.round_finished;

  const players = (state?.players_all ?? []) as any[];
  const expectedIds: string[] = (game?.expected_player_ids as string[]) ?? [];

  const scores = (lastResults?.scores ?? state?.scores ?? {}) as Record<string, number>;
  const leaderboard = Object.entries(scores)
    .map(([player_id, score]) => ({
      player_id,
      score: typeof score === "number" ? score : 0,
      name: players.find((p) => p.player_id === player_id)?.name ?? player_id,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const canOpenVote = phase === "game" && status === "reveal" && !!currentRoundId && !!currentItemId;
  const canEndItem = phase === "game" && status === "reveal_wait";
  const canNextRound = phase === "game" && status === "round_recap" && roundFinished;
  const isGameOver = phase === "game_over";

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

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Contrôle</div>

        <div className="small mono" style={{ whiteSpace: "pre-line" }}>
          {`round_index: ${game?.current_round_index ?? "—"}
item_index: ${game?.current_item_index ?? "—"}
round_id: ${currentRoundId ?? "—"}
item_id: ${currentItemId ?? "—"}`}
        </div>

        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button
            className="btn"
            disabled={!canOpenVote}
            onClick={() =>
              sendMsg({
                type: "REEL_OPENED",
                payload: { round_id: currentRoundId!, item_id: currentItemId! },
              })
            }
          >
            Ouvrir vote
          </button>

          <button className="btn" disabled={!canEndItem} onClick={() => sendMsg({ type: "END_ITEM", payload: {} })}>
            Terminer item
          </button>

          <button className="btn" disabled={!canNextRound} onClick={() => sendMsg({ type: "START_NEXT_ROUND", payload: {} })}>
            Round suivant
          </button>
        </div>

        {lastRecapRoundId ? (
          <div className="small" style={{ marginTop: 10, opacity: 0.8 }}>
            ROUND_RECAP: <span className="mono">{lastRecapRoundId}</span>
          </div>
        ) : null}
      </div>

      {phase === "game" && status === "vote" ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Votes</div>

          <div className="small" style={{ opacity: 0.8 }}>
            {expectedIds.length} joueurs attendus
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {expectedIds.map((pid) => {
              const p = players.find((x) => x.player_id === pid);
              const voted = votedSet.has(pid);
              return (
                <div key={pid} className="row" style={{ justifyContent: "space-between" }}>
                  <span className="mono">{p?.name ?? pid}</span>
                  <span className={voted ? "badge ok" : "badge warn"}>{voted ? "voted" : "…"}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {lastResults ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Résultat item</div>
          <div className="small mono" style={{ whiteSpace: "pre-line" }}>
            {`round_id: ${lastResults.round_id}
item_id: ${lastResults.item_id}
true_sender_ids: ${lastResults.true_sender_ids.join(", ")}`}
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
