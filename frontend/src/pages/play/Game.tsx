import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { GameRoundActiveState, GamePlayersInGame, GameSendersInGame, GameStateSync, StateSyncRes } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearPlaySession, loadPlaySession } from "../../lib/storage";

import styles from "./Game.module.css";

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
  const [submitting, setSubmitting] = useState(false);

  // local helper: resets UI for a new vote target
  function resetVoteUi(next: VoteUi | null) {
    setVoteUi(next);
    setSelections([]);
    setAcked(false);
    setSubmitting(false);
  }

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

      const ra = (p.game?.round_active ?? null) as GameRoundActiveState | null;

      // Not in voting -> hard reset vote UI
      if (!ra || ra.phase !== "voting" || !ra.active_item_id || !ra.current_round_id) {
        if (voteUi !== null) resetVoteUi(null);
        return;
      }

      // In voting -> ensure UI matches current vote target
      const itemId = ra.active_item_id;
      const rid = ra.current_round_id;
      const k = ra.items.find((it) => it.item_id === itemId)?.k ?? 0;

      const next: VoteUi = { round_id: rid, item_id: itemId, k, ends_at_ms: ra.voting?.force_close_ends_at_ms };

      setVoteUi((prev) => {
        if (prev && prev.round_id === next.round_id && prev.item_id === next.item_id) {
          // Same target -> just update k / countdown
          if (prev.k !== next.k || prev.ends_at_ms !== next.ends_at_ms) {
            return { ...prev, k: next.k, ends_at_ms: next.ends_at_ms };
          }
          return prev;
        }

        // New vote target -> reset cleanly
        setSelections([]);
        setAcked(false);
        setSubmitting(false);
        return next;
      });

      return;
    }

    if (m.type === "START_VOTE") {
      setErr("");
      const next: VoteUi = {
        round_id: m.payload.round_id,
        item_id: m.payload.item_id,
        k: (m.payload as any).k ?? 0,
      };
      resetVoteUi(next);
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
      const reason = (m.payload as any).reason as string | undefined;

      setSubmitting(false);

      if (accepted) {
        setAcked(true);
        setErr("");
      } else {
        // Important: allow retry if rejected
        setAcked(false);

        // normalize reasons into user-facing messages
        if (reason === "late" || reason === "not_in_vote") {
          setErr("Vote trop tard. Attends le prochain vote.");
          // If we're late, clear selections to avoid confusion
          setSelections([]);
        } else if (reason) {
          setErr(`Vote refusé: ${reason}`);
        } else {
          setErr("Vote refusé.");
        }
      }
      return;
    }

    // Ignore other events; sync will update view
    if (m.type === "ROUND_SCORE_MODAL" || m.type === "VOTE_RESULTS" || m.type === "ITEM_VOTED" || m.type === "GAME_START") {
      setErr("");
      return;
    }
  }

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Game (Play)</div>
        <div className={`card ${styles.errorBox}`} style={{ padding: 12 }}>
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
    if (acked || submitting) return;

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
    if (acked || submitting) return;

    setSubmitting(true);
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
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div>
          <div className="h1" style={{ margin: 0 }}>
            Game (Play)
          </div>
          <div className="small mono" style={{ marginTop: 4, opacity: 0.85 }}>
            {`room: ${session.room_code}   •   phase: ${phase}`}
          </div>
        </div>

        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <span className="badge ok">WS: {wsStatus}</span>
          <span className="badge ok">score: {myScore}</span>
        </div>
      </div>

      {err ? (
        <div className={`card ${styles.errorBox}`} style={{ padding: 12 }}>
          {err}
        </div>
      ) : null}

      <div className={styles.main}>
        {isGameOver ? (
          <div className="card">
            <div className="h2">Partie terminée</div>
            <div className={styles.hint}>Regarde l’écran Master pour le classement final.</div>
          </div>
        ) : isVoting && voteUi ? (
          <div className="card" style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="h2" style={{ marginBottom: 6 }}>
              Vote
            </div>

            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div className={styles.hint}>Sélectionne 0..{voteUi.k} sender(s)</div>
              {countdown !== null ? <span className="badge warn">Fermeture {countdown}s</span> : <span className="badge ok">Ouvert</span>}
            </div>

            <div className={styles.senderList}>
              {sendersSorted.map((s) => {
                const selected = selections.includes(s.sender_id);
                return (
                  <button
                    key={s.sender_id}
                    className={`btn ${styles.senderBtn}`}
                    onClick={() => toggleSelection(s.sender_id)}
                    disabled={acked || submitting}
                    style={{
                      opacity: selected ? 1 : 0.9,
                      borderColor: selected ? "rgba(255,255,255,0.55)" : undefined,
                    }}
                  >
                    <div className={styles.senderIcon}>
                      {s.avatar_url ? (
                        <img src={s.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: "100%", height: "100%", background: s.color, opacity: 0.85 }} />
                      )}
                    </div>

                    <span className="mono" style={{ flex: "1 1 auto" }}>
                      {selected ? "✓ " : ""}
                      {s.name}
                    </span>

                    <span className="small" style={{ opacity: 0.75 }}>
                      {selected ? "sélectionné" : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="row" style={{ marginTop: 10, gap: 10, justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 10 }}>
                <button className="btn" disabled={acked || submitting || !myPlayerId} onClick={submitVote}>
                  {acked ? "Envoyé" : submitting ? "Envoi..." : "Valider"}
                </button>
                <button className="btn" disabled={acked || submitting} onClick={() => setSelections([])}>
                  Clear
                </button>
              </div>

              <div className="small mono" style={{ opacity: 0.85 }}>
                {selections.length}/{voteUi.k}
              </div>
            </div>

            <div className={styles.hint} style={{ marginTop: 10 }}>
              Après validation, regarde l’écran Master (le reveal est affiché là-bas).
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="h2">En attente</div>
            <div className={styles.hint}>Regarde l’écran Master. Le vote apparaîtra ici quand le Master ouvrira un réel.</div>
          </div>
        )}

        <div className={`card ${styles.footer}`}>
          <div className="h2">Scores</div>
          {leaderboard.length === 0 ? (
            <div className="small">Aucun score.</div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {leaderboard.slice(0, 6).map((r, i) => (
                <div key={r.player_id} className="row" style={{ justifyContent: "space-between" }}>
                  <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i + 1}. {r.name}
                  </span>
                  <span className="badge ok">{r.score}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
