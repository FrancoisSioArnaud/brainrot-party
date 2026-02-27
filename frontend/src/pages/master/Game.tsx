import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ServerToClientMsg } from "@brp/contracts/ws";
import type {
  GameRoundActiveState,
  GameRoundScoreModalState,
  GamePlayersInGame,
  GameSendersInGame,
  GameStateSync,
  RoundItemPublic,
  StateSyncRes,
  VoteResultsPublic,
} from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearMasterSession, loadMasterSession } from "../../lib/storage";

import styles from "./Game.module.css";

type ViewState = {
  room_code: string;
  phase: string;
  setup_ready: boolean;
  scores: Record<string, number>;
  game: GameStateSync | null;
};

type RevealUiState = {
  results: VoteResultsPublic;
  stage: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  running: boolean;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function openUrl(url: string) {
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // ignore
  }
}

function sortByName<T extends { name: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

export default function MasterGame() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);
  const clientRef = useRef<BrpWsClient | null>(null);

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ViewState | null>(null);

  // Reveal (local master only) - buffered on VOTE_RESULTS, started ONLY on click
  const [reveal, setReveal] = useState<RevealUiState | null>(null);
  const revealTimersRef = useRef<number[]>([]);
  const [pendingPulse, setPendingPulse] = useState(false);

  // For countdown rendering (force close)
  const [nowTick, setNowTick] = useState(0);

  function clearRevealTimers() {
    for (const id of revealTimersRef.current) window.clearTimeout(id);
    revealTimersRef.current = [];
  }

  function schedule(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms);
    revealTimersRef.current.push(id);
  }

  function startRevealSequence(results: VoteResultsPublic) {
    clearRevealTimers();
    setPendingPulse(false);

    setReveal({ results, stage: 1, running: true });

    // Sequenced, automatic (master-only)
    schedule(() => setReveal((r) => (r ? { ...r, stage: 2 } : r)), 650);
    schedule(() => setReveal((r) => (r ? { ...r, stage: 3 } : r)), 1300);
    schedule(() => setReveal((r) => (r ? { ...r, stage: 4 } : r)), 2000);
    schedule(() => setReveal((r) => (r ? { ...r, stage: 5 } : r)), 2700);
    schedule(() => setReveal((r) => (r ? { ...r, stage: 6 } : r)), 3500);

    schedule(() => {
      setReveal(null);
      // After reveal clear: pulse buttons of remaining pending items
      setPendingPulse(true);
      schedule(() => setPendingPulse(false), 420);
    }, 4200);
  }

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

    return () => {
      clearRevealTimers();
      c.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.room_code]);

  useEffect(() => {
    if (!state) return;
    if (state.phase === "lobby") nav("/master/lobby", { replace: true });
  }, [state?.phase, nav, state]);

  // Drive countdown label updates when force-close is running.
  useEffect(() => {
    const endsAt = (state?.game as any)?.round_active?.voting?.force_close_ends_at_ms ?? null;
    if (!endsAt) return;
    const id = window.setInterval(() => setNowTick((x) => x + 1), 200);
    return () => window.clearInterval(id);
  }, [state?.game]);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      const msg = `${(m.payload as any).error}${(m.payload as any).message ? `: ${(m.payload as any).message}` : ""}`;
      setErr(msg);

      const e = (m.payload as any).error;
      if (e === "room_expired" || e === "room_not_found") {
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
        scores: p.scores ?? {},
        game: p.game ?? null,
      });
      return;
    }

    if (m.type === "VOTE_RESULTS") {
      setErr("");
      // BUFFER ONLY. Reveal starts ONLY on click.
      const payload = m.payload as any;
      const results: VoteResultsPublic = {
        round_id: payload.round_id,
        item_id: payload.item_id,
        true_senders: payload.true_senders ?? [],
        players: payload.players ?? [],
      };
      setReveal({ results, stage: 0, running: false });
      return;
    }

    if (m.type === "GAME_START" || m.type === "START_VOTE" || m.type === "ITEM_VOTED" || m.type === "ROUND_SCORE_MODAL") {
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
  const game = state?.game ?? null;
  const scores = state?.scores ?? {};

  const playersInGame: GamePlayersInGame = (game?.players_in_game ?? []) as any;
  const sendersInGame: GameSendersInGame = (game?.senders_in_game ?? []) as any;

  const view = game?.view ?? null;
  const roundActive: GameRoundActiveState | null = (game?.round_active ?? null) as any;
  const roundScore: GameRoundScoreModalState | null = (game?.round_score_modal ?? null) as any;

  const items: RoundItemPublic[] = (roundActive?.items ?? []) as any;

  const revealedSenderIds = useMemo(() => {
    const ids: string[] = [];
    for (const it of items) {
      if (it.status === "voted" && Array.isArray(it.revealed_sender_ids)) ids.push(...it.revealed_sender_ids);
    }
    return new Set(uniq(ids));
  }, [items]);

  const isRoundActive = view === "round_active" && !!roundActive;
  const isWaiting = isRoundActive && roundActive!.phase === "waiting";
  const isVoting = isRoundActive && roundActive!.phase === "voting";
  const currentRoundId = roundActive?.current_round_id ?? null;
  const activeItemId = roundActive?.active_item_id ?? null;

  const currentVoting = roundActive?.voting ?? null;
  const votedSet = useMemo(() => new Set(currentVoting?.votes_received_player_ids ?? []), [currentVoting?.votes_received_player_ids]);

  const pendingRevealReady = !!reveal && reveal.stage === 0 && reveal.running === false;

  // Key change: reveal can be started as soon as results are buffered (even if server hasn't flipped back to waiting yet)
  const canStartReveal = pendingRevealReady && reveal?.running !== true && wsStatus === "open";

  const forceCloseEndsAt = currentVoting?.force_close_ends_at_ms ?? null;

  const countdownLabel = useMemo(() => {
    if (!forceCloseEndsAt) return null;
    const leftMs = forceCloseEndsAt - Date.now();
    const s = Math.max(0, Math.ceil(leftMs / 1000));
    return `Fermeture dans ${s}s`;
  }, [forceCloseEndsAt, nowTick]);

  const ranking = useMemo(() => {
    const rows = playersInGame.map((p) => ({
      player_id: p.player_id,
      name: p.name,
      score: typeof scores[p.player_id] === "number" ? scores[p.player_id] : 0,
    }));
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
    return rows;
  }, [playersInGame, scores]);

  const nonRevealedSenders = useMemo(() => {
    // Server removes revealed senders as soon as item becomes voted.
    // For reveal animation, keep true senders visible until stage 3.
    const base = sendersInGame
      .filter((s) => !revealedSenderIds.has(s.sender_id))
      .map((s) => ({ sender_id: s.sender_id, name: s.name, avatar_url: s.avatar_url, color: s.color }));

    if (reveal?.running && reveal.stage > 0 && reveal.stage < 3 && reveal.results) {
      for (const sid of reveal.results.true_senders ?? []) {
        if (!base.find((x) => x.sender_id === sid)) {
          const s = sendersInGame.find((ss) => ss.sender_id === sid);
          if (s) base.push({ sender_id: s.sender_id, name: s.name, avatar_url: s.avatar_url, color: s.color });
        }
      }
    }

    return sortByName(base);
  }, [sendersInGame, revealedSenderIds, reveal]);

  // Reveal helpers
  const revealStage = reveal?.stage ?? 0;
  const revealResults = reveal?.results ?? null;
  const trueSenders = revealResults?.true_senders ?? [];

  const votesByPlayer = useMemo(() => {
    if (!revealResults) return new Map<string, { selections: string[]; correct: string[]; incorrect: string[] }>();
    const m = new Map<string, { selections: string[]; correct: string[]; incorrect: string[] }>();
    for (const r of revealResults.players ?? []) {
      m.set(r.player_id, {
        selections: r.selections ?? [],
        correct: r.correct ?? [],
        incorrect: r.incorrect ?? [],
      });
    }
    return m;
  }, [revealResults]);

  function onClickItem(it: RoundItemPublic) {
    openUrl(it.reel.url);

    // Only start vote on pending items when waiting
    if (isWaiting && it.status === "pending") {
      sendMsg({ type: "OPEN_ITEM", payload: { round_id: it.round_id, item_id: it.item_id } });
    }
  }

  const showScoreModal = view === "round_score_modal" && !!roundScore;

  return (
    <div className={styles.page}>

      {err ? (
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)", padding: 12 }}>
          {err}
        </div>
      ) : null}

      {isRoundActive ? (
        <div className={styles.main}>
          {/* Left: items */}
          <div className={styles.itemsPanel}>
            <div className="card" style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div>
                    <div className="h1" style={{ margin: 0 }}>
                      Game
                    </div>
                    <div className="small mono" style={{ marginTop: 4, opacity: 0.85 }}>
                      {`room: ${state?.room_code ?? session.room_code}   •   phase: ${phase}   •   view: ${view ?? "—"}`}
                    </div>
                  </div>
                  <div className="h2" style={{ marginBottom: 4 }}>
                    Round
                  </div>
                  <div className="small mono" style={{ whiteSpace: "pre-line", opacity: 0.85 }}>
                    {`round numéro ${currentRoundId ?? "—"}`}
                  </div>
                </div>

                <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                  {isVoting ? (
                    <>
                      <button
                        className="btn"
                        onClick={() =>
                          sendMsg({ type: "FORCE_CLOSE_VOTE", payload: { round_id: currentRoundId!, item_id: activeItemId! } })
                        }
                        disabled={wsStatus !== "open" || !currentRoundId || !activeItemId || !!forceCloseEndsAt}
                      >
                        Forcer fermeture (10s)
                      </button>
                      {countdownLabel ? <span className="badge warn">{countdownLabel}</span> : <span className="badge ok">Vote en cours</span>}
                    </>
                  ) : (
                    <>
                      <span className="badge ok">{isWaiting ? "Waiting" : "—"}</span>
                      <button
                        className="btn"
                        disabled={!canStartReveal}
                        onClick={() => {
                          if (reveal?.results) startRevealSequence(reveal.results);
                        }}
                        title={!pendingRevealReady ? "En attente des résultats (VOTE_RESULTS)" : "Démarrer la séquence Reveal"}
                      >
                        Révéler le résultat
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.itemsGrid}>
              {items.map((it) => {
                const isPending = it.status === "pending";
                const isVoted = it.status === "voted";
                const isActive = isVoting && it.item_id === activeItemId;

                const pulse = pendingPulse && isPending && isWaiting;

                const slotIds = isVoted && it.revealed_sender_ids ? it.revealed_sender_ids : [];
                const slotsCount = Math.max(0, it.k);

                // During reveal stages 1-2, keep slots visually empty,
                // then "move" true senders into slots at stage 3.
                const revealIsForThisItem = !!revealResults && revealResults.item_id === it.item_id;
                const slotIdsForUi = revealIsForThisItem && revealStage > 0 && revealStage < 3 ? [] : slotIds;

                return (
                  <div
                    key={it.item_id}
                    className={`card ${styles.itemCard}`}
                    style={{
                      borderColor: isActive ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)",
                      transform: pulse ? "scale(1.03)" : undefined,
                      transition: "transform 180ms ease",
                      opacity: isVoting && !isActive ? 0.82 : 1,
                    }}
                  >
                    <div className={`${styles.url} mono`}>{it.reel.url}</div>

                    <button
                      className="btn"
                      onClick={() => onClickItem(it)}
                      disabled={wsStatus !== "open" || (isPending ? !isWaiting : false)}
                      style={{ width: "100%" }}
                    >
                      Voir le réel
                    </button>

                    <div className={styles.slots}>
                      {Array.from({ length: slotsCount }).map((_, i) => {
                        const senderId = slotIdsForUi[i] ?? null;
                        const sender = senderId ? sendersInGame.find((s) => s.sender_id === senderId) : null;

                        const moved = revealStage >= 3 && revealResults?.item_id === it.item_id && !!senderId;
                        const emphasizeTrue =
                          revealStage === 2 && revealResults?.item_id === it.item_id && senderId && trueSenders.includes(senderId);

                        return (
                          <div
                            key={`${it.item_id}-slot-${i}`}
                            className={styles.slot}
                            style={{
                              border: senderId ? "1px solid rgba(255,255,255,0.22)" : "1px dashed rgba(255,255,255,0.22)",
                              background: senderId ? "rgba(255,255,255,0.06)" : "transparent",
                              transform: emphasizeTrue ? "scale(1.14)" : moved ? "scale(1.06)" : undefined,
                              transition: "transform 220ms ease",
                            }}
                            title={sender?.name ?? ""}
                          >
                            {sender ? (
                              sender.avatar_url ? (
                                <img src={sender.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                <div style={{ width: "100%", height: "100%", background: sender.color, opacity: 0.85 }} />
                              )
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div className="h2" style={{ marginBottom: 8 }}>
                Senders non révélés
              </div>
              <div className={styles.sendersBar}>
                {nonRevealedSenders.length === 0 ? (
                  <div className="small">Aucun sender restant.</div>
                ) : (
                  nonRevealedSenders.map((s) => {
                    const isTruePulse = revealStage === 2 && trueSenders.includes(s.sender_id);
                    return (
                      <div key={s.sender_id} style={{ flex: "0 0 auto", textAlign: "center" }}>
                        <div
                          className={styles.senderTile}
                          style={{ transform: isTruePulse ? "scale(1.35)" : undefined, transition: "transform 240ms ease" }}
                          title={s.name}
                        >
                          {s.avatar_url ? (
                            <img src={s.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <div style={{ width: "100%", height: "100%", background: s.color, opacity: 0.85 }} />
                          )}
                        </div>
                        <div className={styles.senderName}>{s.name}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Players bottom row */}
      {isRoundActive ? (
        <div className={`card ${styles.playersRow}`} style={{ padding: 12 }}>
          <div className="h2" style={{ marginBottom: 8 }}>
            Players
          </div>
          <div className={styles.playersBar}>
            {playersInGame.map((p) => {
              const score = typeof scores[p.player_id] === "number" ? scores[p.player_id] : 0;

              const vote = votesByPlayer.get(p.player_id);
              const showVotes = revealStage >= 1 && revealStage <= 5 && !!revealResults;
              const showFeedback = revealStage >= 4 && revealStage <= 5;
              const pointsPulse = revealStage === 5 && !!revealResults;

              return (
                <div key={p.player_id} style={{ flex: "0 0 auto", textAlign: "center", minWidth: 92 }}>
                  {showVotes ? (
                    <div className={styles.voteChips}>
                      {(vote?.selections ?? []).map((sid, idx) => {
                        const sender = sendersInGame.find((s) => s.sender_id === sid);
                        const good = (vote?.correct ?? []).includes(sid);
                        const bad = (vote?.incorrect ?? []).includes(sid);

                        const border =
                          showFeedback && good
                            ? "2px solid rgba(0,255,120,0.75)"
                            : showFeedback && bad
                            ? "2px solid rgba(255,80,80,0.75)"
                            : "1px solid rgba(255,255,255,0.18)";

                        const scale = showFeedback && good ? "scale(1.08)" : showFeedback && bad ? "scale(0.92)" : "scale(1)";

                        return (
                          <div
                            key={`${p.player_id}-vote-${idx}`}
                            className={styles.voteChip}
                            style={{ border, transform: scale, transition: "transform 180ms ease" }}
                            title={sender?.name ?? sid}
                          >
                            {sender?.avatar_url ? (
                              <img src={sender.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <div style={{ width: "100%", height: "100%", background: sender?.color ?? "#666", opacity: 0.85 }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ minHeight: 42 }} />
                  )}

                  <div className={styles.playerCircle} title={p.name}>
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: p.color, opacity: 0.85 }} />
                    )}
                  </div>

                  <div
                    className="small"
                    style={{ marginTop: 6, maxWidth: 92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {p.name}
                  </div>

                  <div
                    className="badge ok"
                    style={{
                      marginTop: 6,
                      display: "inline-block",
                      transform: pointsPulse ? "scale(1.12)" : undefined,
                      transition: "transform 220ms ease",
                    }}
                  >
                    {score}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Score modal overlay */}
      {showScoreModal ? (
        <div className={styles.modalOverlay}>
          <div className={`card ${styles.modal}`}>
            <div className="h1" style={{ marginBottom: 6 }}>
              Score du round
            </div>
            <div className="small" style={{ opacity: 0.85 }}>
              {roundScore?.game_over ? "Tous les réels sont épuisés." : "Round terminé."}
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {(roundScore?.ranking ?? []).map((r) => {
                const name = playersInGame.find((p) => p.player_id === r.player_id)?.name ?? r.player_id;
                return (
                  <div key={r.player_id} className="row" style={{ justifyContent: "space-between" }}>
                    <span className="mono">
                      {r.rank}. {name}
                    </span>
                    <span className="badge ok">{r.score_total}</span>
                  </div>
                );
              })}
            </div>

            <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
              {!roundScore?.game_over ? (
                <button className="btn" onClick={() => sendMsg({ type: "START_NEXT_ROUND", payload: {} })} disabled={wsStatus !== "open"}>
                  Round suivant
                </button>
              ) : (
                <button className="btn" onClick={() => nav("/", { replace: true })}>
                  Retour landing
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
