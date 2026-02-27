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

type RevealStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type RevealUiState = {
  results: VoteResultsPublic;
  stage: RevealStage;
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

function buildRevealKey(r: VoteResultsPublic) {
  return `${r.round_id}:${r.item_id}`;
}

export default function MasterGame() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);
  const clientRef = useRef<BrpWsClient | null>(null);

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ViewState | null>(null);

  // Reveal (local master only)
  const [reveal, setReveal] = useState<RevealUiState | null>(null);
  const revealKeyRef = useRef<string | null>(null);
  const revealTimersRef = useRef<number[]>([]);
  const [pendingPulse, setPendingPulse] = useState(false);

  // timings (ms) per stage change
  const REVEAL_T = {
    toVotes: 0,
    toTruePulse: 650, // stage 2
    toMove: 1300, // stage 3
    toFeedback: 2000, // stage 4
    toPoints: 2700, // stage 5
    toClear: 3500, // stage 6
    end: 4200,
    pendingPulse: 420,
  };

  function clearRevealTimers() {
    for (const id of revealTimersRef.current) window.clearTimeout(id);
    revealTimersRef.current = [];
  }

  function schedule(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms);
    revealTimersRef.current.push(id);
  }

  function resetRevealAll() {
    clearRevealTimers();
    revealKeyRef.current = null;
    setReveal(null);
    setPendingPulse(false);
  }

  function startRevealSequence(results: VoteResultsPublic) {
    // Guard: only start if we have a pending reveal (stage=0, not running)
    setReveal((prev) => {
      if (!prev) return prev;
      if (prev.running) return prev;
      if (buildRevealKey(prev.results) !== buildRevealKey(results)) return prev;
      if (prev.stage !== 0) return prev;
      return prev;
    });

    clearRevealTimers();
    setPendingPulse(false);

    const key = buildRevealKey(results);
    revealKeyRef.current = key;

    setReveal({ results, stage: 1, running: true });

    schedule(() => setReveal((r) => (r && buildRevealKey(r.results) === key ? { ...r, stage: 2 } : r)), REVEAL_T.toTruePulse);
    schedule(() => setReveal((r) => (r && buildRevealKey(r.results) === key ? { ...r, stage: 3 } : r)), REVEAL_T.toMove);
    schedule(() => setReveal((r) => (r && buildRevealKey(r.results) === key ? { ...r, stage: 4 } : r)), REVEAL_T.toFeedback);
    schedule(() => setReveal((r) => (r && buildRevealKey(r.results) === key ? { ...r, stage: 5 } : r)), REVEAL_T.toPoints);
    schedule(() => setReveal((r) => (r && buildRevealKey(r.results) === key ? { ...r, stage: 6 } : r)), REVEAL_T.toClear);

    schedule(() => {
      // End: clear votes + pulse pending items
      setReveal(null);
      revealKeyRef.current = null;

      setPendingPulse(true);
      schedule(() => setPendingPulse(false), REVEAL_T.pendingPulse);
    }, REVEAL_T.end);
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
      resetRevealAll();
      c.close();
    };
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

      // Hard guards on reconnect/state changes:
      // - If vote starts, cancel any pending reveal.
      const ra = (p.game?.round_active ?? null) as GameRoundActiveState | null;
      if (ra && ra.phase === "voting") {
        // During voting, reveal must not be available; cancel all.
        resetRevealAll();
      }

      // - If round_score_modal shows up, cancel reveal animations (avoid overlay weirdness).
      if (p.game?.view === "round_score_modal") {
        resetRevealAll();
      }

      return;
    }

    if (m.type === "VOTE_RESULTS") {
      setErr("");

      // Store results for master to trigger reveal.
      // Guard: if reveal is already running, ignore.
      const payload = m.payload as any;
      const results: VoteResultsPublic = {
        round_id: payload.round_id,
        item_id: payload.item_id,
        true_senders: payload.true_senders ?? [],
        players: payload.players ?? [],
      };

      setReveal((prev) => {
        if (prev?.running) return prev;
        const key = buildRevealKey(results);

        // If we already have the exact same pending results, keep them.
        if (prev && buildRevealKey(prev.results) === key && prev.stage === 0 && prev.running === false) return prev;

        revealKeyRef.current = key;
        return { results, stage: 0, running: false };
      });

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

  const isRoundActive = view === "round_active" && !!roundActive;
  const isWaiting = isRoundActive && roundActive!.phase === "waiting";
  const isVoting = isRoundActive && roundActive!.phase === "voting";
  const currentRoundId = roundActive?.current_round_id ?? null;
  const activeItemId = roundActive?.active_item_id ?? null;

  const currentVoting = roundActive?.voting ?? null;
  const votedSet = useMemo(() => new Set(currentVoting?.votes_received_player_ids ?? []), [currentVoting?.votes_received_player_ids]);

  const revealStage: RevealStage = reveal?.stage ?? 0;
  const revealRunning = reveal?.running === true;
  const revealPending = reveal && reveal.stage === 0 && reveal.running === false;

  const revealResults = reveal?.results ?? null;
  const revealKey = revealResults ? buildRevealKey(revealResults) : null;

  const trueSenders = revealResults?.true_senders ?? [];

  // Button enabled ONLY when:
  // - round_active.waiting
  // - we have pending VOTE_RESULTS (stage 0)
  // - not already running
  const canStartReveal = isWaiting && !!revealPending && !revealRunning;

  // Deterministic: keep “true senders” visible in pool until stage 3.
  // Server state already has them removed from pool immediately (item voted), so we locally override.
  const revealedSenderIds = useMemo(() => {
    const ids: string[] = [];
    for (const it of items) {
      if (it.status === "voted" && Array.isArray(it.revealed_sender_ids)) ids.push(...it.revealed_sender_ids);
    }
    return new Set(uniq(ids));
  }, [items]);

  const poolVisibleSenderIds = useMemo(() => {
    const base = new Set<string>();
    for (const s of sendersInGame) base.add(s.sender_id);

    // Remove already revealed
    for (const id of revealedSenderIds) base.delete(id);

    // During reveal stages 1-2 (before move), keep the just-revealed true senders in the pool
    if (revealResults && revealStage > 0 && revealStage < 3) {
      for (const sid of trueSenders) base.add(sid);
    }

    return base;
  }, [sendersInGame, revealedSenderIds, revealResults, revealStage, trueSenders]);

  const nonRevealedSenders = useMemo(() => {
    const remaining = sendersInGame
      .filter((s) => poolVisibleSenderIds.has(s.sender_id))
      .map((s) => ({ sender_id: s.sender_id, name: s.name, avatar_url: s.avatar_url, color: s.color }));
    return sortByName(remaining);
  }, [sendersInGame, poolVisibleSenderIds]);

  // Deterministic: hide slots content for the just-voted item until stage 3
  function shouldShowSlotsForItem(item_id: string) {
    if (!revealResults) return true;
    if (revealStage === 0) return true;
    if (revealResults.item_id !== item_id) return true;
    return revealStage >= 3;
  }

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

  const forceCloseEndsAt = currentVoting?.force_close_ends_at_ms ?? null;
  const countdownLabel = useMemo(() => {
    if (!forceCloseEndsAt) return null;
    const leftMs = forceCloseEndsAt - Date.now();
    const s = Math.max(0, Math.ceil(leftMs / 1000));
    return `Fermeture dans ${s}s`;
  }, [forceCloseEndsAt]);

  const ranking = useMemo(() => {
    const rows = playersInGame.map((p) => ({
      player_id: p.player_id,
      name: p.name,
      score: typeof scores[p.player_id] === "number" ? scores[p.player_id] : 0,
    }));
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
    return rows;
  }, [playersInGame, scores]);

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
      <div className={styles.topBar}>
        <div>
          <div className="h1" style={{ margin: 0 }}>
            Game (Master)
          </div>
          <div className="small mono" style={{ marginTop: 4, opacity: 0.85 }}>
            {`room: ${state?.room_code ?? session.room_code}   •   phase: ${phase}   •   view: ${view ?? "—"}`}
          </div>
        </div>

        <div className={styles.topBarRight}>
          <span className="badge ok">WS: {wsStatus}</span>
          <span className={setupReady ? "badge ok" : "badge warn"}>{setupReady ? "Setup OK" : "Setup missing"}</span>
          <button className="btn" onClick={() => sendMsg({ type: "REQUEST_SYNC", payload: {} })} disabled={wsStatus !== "open"}>
            Refresh
          </button>
        </div>
      </div>

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
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div className="h2" style={{ marginBottom: 4 }}>
                    Round
                  </div>
                  <div className="small mono" style={{ whiteSpace: "pre-line", opacity: 0.85 }}>
                    {`round_id: ${currentRoundId ?? "—"}\nmode: ${roundActive?.phase ?? "—"}`}
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
                        disabled={wsStatus !== "open" || !currentRoundId || !activeItemId}
                      >
                        Forcer fermeture (10s)
                      </button>
                      {countdownLabel ? <span className="badge warn">{countdownLabel}</span> : <span className="badge ok">Vote en cours</span>}
                    </>
                  ) : (
                    <>
                      <span className="badge ok">Waiting</span>
                      <button
                        className="btn"
                        disabled={!canStartReveal}
                        onClick={() => {
                          if (!revealResults) return;
                          if (!isWaiting) return;
                          if (!revealPending) return;
                          if (revealRunning) return;

                          // extra guard: key must match
                          const k = buildRevealKey(revealResults);
                          if (revealKeyRef.current && revealKeyRef.current !== k) return;

                          startRevealSequence(revealResults);
                        }}
                        title={
                          canStartReveal
                            ? "Lancer la séquence Reveal"
                            : isWaiting
                            ? "En attente de VOTE_RESULTS"
                            : "Disponible seulement en waiting"
                        }
                      >
                        Révéler le résultat
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Debug tiny line */}
              <div className="small mono" style={{ marginTop: 10, opacity: 0.7 }}>
                {`reveal: ${revealPending ? "pending" : revealRunning ? "running" : "none"}${revealKey ? ` (${revealKey})` : ""}`}
              </div>
            </div>

            <div className={styles.itemsGrid}>
              {items.map((it) => {
                const isPending = it.status === "pending";
                const isVoted = it.status === "voted";
                const isActive = isVoting && it.item_id === activeItemId;

                const pulse = pendingPulse && isPending && isWaiting;

                const showSlots = shouldShowSlotsForItem(it.item_id);
                const slotIds = showSlots && isVoted && it.revealed_sender_ids ? it.revealed_sender_ids : [];
                const slotsCount = Math.max(0, it.k);

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
                      disabled={
                        wsStatus !== "open" ||
                        (isPending ? !isWaiting : false) // pending only clickable in waiting; voted always clickable (local open)
                      }
                      style={{ width: "100%" }}
                    >
                      Voir le réel
                    </button>

                    <div className={styles.slots}>
                      {Array.from({ length: slotsCount }).map((_, i) => {
                        const senderId = slotIds[i] ?? null;
                        const sender = senderId ? sendersInGame.find((s) => s.sender_id === senderId) : null;

                        // Stage 3: show slots content; before that it should look empty (deterministic)
                        const isJustRevealedItem = !!revealResults && revealResults.item_id === it.item_id && revealStage > 0;
                        const isMoveStage = isJustRevealedItem && revealStage === 3;

                        return (
                          <div
                            key={`${it.item_id}-slot-${i}`}
                            className={styles.slot}
                            style={{
                              border: senderId ? "1px solid rgba(255,255,255,0.22)" : "1px dashed rgba(255,255,255,0.22)",
                              background: senderId ? "rgba(255,255,255,0.06)" : "transparent",
                              transform: isMoveStage ? "scale(1.10)" : undefined,
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

                    <div className="small" style={{ opacity: 0.75 }}>
                      status: {it.status}
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
                    const isTrue = trueSenders.includes(s.sender_id);
                    const doPulse = revealStage === 2 && isTrue;
                    const doFadeOut = revealStage >= 3 && isTrue && revealResults; // disappear at/after move

                    return (
                      <div key={s.sender_id} style={{ flex: "0 0 auto", textAlign: "center" }}>
                        <div
                          className={`${styles.senderTile} ${doFadeOut ? styles.fadeOut : styles.fadeIn}`}
                          style={{ transform: doPulse ? "scale(1.35)" : undefined }}
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

          {/* Right: sidebar */}
          <div className={styles.sidebar}>
            <div className="card" style={{ padding: 12 }}>
              <div className="h2">Scores</div>
              {ranking.length === 0 ? (
                <div className="small">Aucun score.</div>
              ) : (
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  {ranking.map((r, i) => (
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

            <div className="card" style={{ padding: 12 }}>
              <div className="h2">Votes</div>
              {isVoting ? (
                <>
                  <div className="small" style={{ opacity: 0.85 }}>
                    {votedSet.size}/{currentVoting?.expected_player_ids?.length ?? "—"} voté
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {playersInGame.map((p) => {
                      const voted = votedSet.has(p.player_id);
                      return (
                        <div key={p.player_id} className="row" style={{ justifyContent: "space-between" }}>
                          <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.name}
                          </span>
                          <span className={voted ? "badge ok" : "badge warn"}>{voted ? "voté" : "…"}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="small" style={{ opacity: 0.85 }}>
                  Pas de vote en cours.
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 12 }}>
              <div className="h2">Reveal (master)</div>
              <div className="small mono" style={{ opacity: 0.85, whiteSpace: "pre-line" }}>
                {`pending: ${revealPending ? "yes" : "no"}
running: ${revealRunning ? "yes" : "no"}
stage: ${revealStage}
key: ${revealKey ?? "—"}`}
              </div>
              <div className="small" style={{ marginTop: 10, opacity: 0.8 }}>
                Les sous-étapes Reveal sont locales (master) et séquencées automatiquement.
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
