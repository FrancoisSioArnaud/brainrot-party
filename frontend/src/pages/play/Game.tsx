import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { GameStateSync, GameRoundActiveState, GamePlayersInGame, GameSendersInGame, StateSyncRes } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearPlaySession, loadPlaySession } from "../../lib/storage";

type VoteUi = {
  round_id: string;
  item_id: string;
  k: number;
  ends_at_ms?: number;
};

function sortByName<T extends { name: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

export default function PlayGame() {
  const nav = useNavigate();
  const session = useMemo(() => loadPlaySession(), []);
  const clientRef = useRef<BrpWsClient | null>(null);

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [err, setErr] = useState("");

  const [phase, setPhase] = useState<string>("—");
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [game, setGame] = useState<GameStateSync | null>(null);

  const [voteUi, setVoteUi] = useState<VoteUi | null>(null);
  const [selections, setSelections] = useState<string[]>([]);
  const [acked, setAcked] = useState(false);

  // tick for countdown display
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((x) => x + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!session) return;

    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    setWsStatus("connecting");
    setErr("");

    c.connectJoinRoom(
      { room_code: session.room_code, device_id: session.device_id },
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
    if (phase === "lobby") nav("/play", { replace: true });
  }, [phase, nav]);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      const msg = `${m.payload.error}${m.payload.message ? `: ${m.payload.message}` : ""}`;
      setErr(msg);

      if (m.payload.error === "room_expired" || m.payload.error === "room_not_found") {
        clearPlaySession();
        nav("/play", { replace: true });
      }
      return;
    }

    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setPhase(p.phase);
      setMyPlayerId(p.my_player_id ?? null);
      setScores(p.scores ?? {});
      setGame(p.game ?? null);

      // If server is not in voting anymore, reset vote UI
      const ra = (p.game?.round_active ?? null) as GameRoundActiveState | null;
      if (!ra || ra.phase !== "voting" || !ra.active_item_id) {
        setVoteUi(null);
        setSelections([]);
        setAcked(false);
      } else {
        // If voting is active, ensure voteUi matches current active vote
        const itemId = ra.active_item_id;
        const rid = ra.current_round_id;
        const k = ra.items.find((it) => it.item_id === itemId)?.k ?? 0;
        setVoteUi((prev) => {
          if (prev && prev.round_id === rid && prev.item_id === itemId) {
            return { ...prev, k, ends_at_ms: ra.voting?.force_close_ends_at_ms };
          }
          setSelections([]);
          setAcked(false);
          return { round_id: rid, item_id: itemId, k, ends_at_ms: ra.voting?.force_close_ends_at_ms };
        });
      }
      return;
    }

    if (m.type === "START_VOTE") {
      setErr("");
      setAcked(false);
      setSelections([]);
      setVoteUi({
        round_id: m.payload.round_id,
        item_id: m.payload.item_id,
        k: (m.payload as any).k ?? 0,
      });
      return;
    }

    if (m.type === "VOTE_FORCE_CLOSE_STARTED") {
      setVoteUi((v) => {
        if (!v) return v;
        if (v.round_id !== m.payload.round_id || v.item_id !== m.payload.item_id) return v;
        return { ...v, ends_at_ms: (m.payload as any).ends_at_ms };
      });
      return;
    }

    if (m.type === "VOTE_ACK") {
      const accepted = (m.payload as any).accepted === true;
      setAcked(accepted);
      if (!accepted) {
        const reason = (m.payload as any).reason as string | undefined;
        if (reason) setErr(`Vote refusé: ${reason}`);
      } else {
        setErr("");
      }
      return;
    }

    if (m.type === "ROUND_SCORE_MODAL" || m.type === "VOTE_RESULTS" || m.type === "ITEM_VOTED" || m.type === "GAME_START") {
      // score updates come through sync; keep UI calm
      setErr("");
      return;
    }
  }

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Game (Play)</div>
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          Pas de session play. Reviens sur /play.
        </div>
      </div>
    );
  }

  const view = game?.view ?? null;
  const roundActive: GameRoundActiveState | null = (game?.round_active ?? null) as any;

  const playersInGame: GamePlayersInGame = (game?.players_in_game ?? []) as any;
  const sendersInGame: GameSendersInGame = (game?.senders_in_game ?? []) as any;

  const sendersSorted = useMemo(() => sortByName(sendersInGame), [sendersInGame]);

  function toggleSelection(sender_id: string) {
    if (!voteUi) return;

    setSelections((prev) => {
      const has = prev.includes(sender_id);
      if (has) return prev.filter((x) => x !== sender_id);
      if (prev.length >= voteUi.k) return prev; // max K
      return [...prev, sender_id];
    });
  }

  function submitVote() {
    if (!voteUi) return;
    if (!myPlayerId) {
      setErr("Choisis un joueur dans le lobby avant de voter.");
      return;
    }

    setErr("");
    clientRef.current?.send({
      type: "SUBMIT_VOTE",
      payload: {
        round_id: voteUi.round_id,
        item_id: voteUi.item_id,
        selections, // 0..K allowed
      },
    });
  }

  const isVoting = !!voteUi && view === "round_active" && roundActive?.phase === "voting";
  const isGameOver = phase === "game_over";

  const myScore = myPlayerId ? (typeof scores[myPlayerId] === "number" ? scores[myPlayerId] : 0) : 0;

  const countdown = useMemo(() => {
    if (!voteUi?.ends_at_ms) return null;
    const left = voteUi.ends_at_ms - Date.now();
    const s = Math.max(0, Math.ceil(left / 1000));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteUi?.ends_at_ms, nowTick]);

  const leaderboard = useMemo(() => {
    const rows = playersInGame.map((p) => ({
      player_id: p.player_id,
      name: p.name,
      score: typeof scores[p.player_id] === "number" ? scores[p.player_id] : 0,
    }));
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
    return rows;
  }, [playersInGame, scores]);

  return (
    <div className="card">
      <div className="h1">Game (Play)</div>

      <div className="row" style={{ marginTop: 8 }}>
        <span className="badge ok">WS: {wsStatus}</span>
        <span className="badge ok">phase: {phase}</span>
        <span className="badge ok">score: {myScore}</span>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      {isGameOver ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Partie terminée</div>
          <div className="small">Regarde l’écran Master pour le classement final.</div>
        </div>
      ) : isVoting && voteUi ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Vote</div>

          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div className="small" style={{ opacity: 0.85 }}>
              Sélectionne 0..{voteUi.k} sender(s)
            </div>
            {countdown !== null ? <span className="badge warn">Fermeture dans {countdown}s</span> : <span className="badge ok">Ouvert</span>}
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {sendersSorted.map((s) => {
              const selected = selections.includes(s.sender_id);
              return (
                <button
                  key={s.sender_id}
                  className="btn"
                  onClick={() => toggleSelection(s.sender_id)}
                  style={{
                    textAlign: "left",
                    opacity: selected ? 1 : 0.9,
                    borderColor: selected ? "rgba(255,255,255,0.55)" : undefined,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                  disabled={acked}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 8, // sender = rounded square
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.18)",
                      flex: "0 0 auto",
                    }}
                  >
                    {s.avatar_url ? (
                      <img src={s.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: s.color, opacity: 0.85 }} />
                    )}
                  </div>

                  <span className="mono" style={{ flex: "1 1 auto" }}>
                    {selected ? "✓ " : ""}{s.name}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="row" style={{ marginTop: 12, gap: 10 }}>
            <button className="btn" disabled={acked || !myPlayerId} onClick={submitVote}>
              {acked ? "Envoyé" : "Valider"}
            </button>

            <div className="small mono" style={{ opacity: 0.8 }}>
              {selections.length}/{voteUi.k}
            </div>

            <button className="btn" disabled={acked} onClick={() => setSelections([])}>
              Clear
            </button>
          </div>

          <div className="small" style={{ marginTop: 10, opacity: 0.8 }}>
            Après validation, regarde l’écran Master (le reveal est affiché là-bas).
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">En attente</div>
          <div className="small">Regarde l’écran Master. Le vote apparaîtra ici quand le Master ouvrira un réel.</div>
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">Scores</div>
        {leaderboard.length === 0 ? (
          <div className="small">Aucun score.</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {leaderboard.slice(0, 6).map((r, i) => (
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
