import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GameClient, GameStateSync } from "../../ws/gameClient";
import styles from "./Game.module.css";

type RevealState =
  | { active: false }
  | {
      active: true;
      item_id: string;
      step: number;
      votes_by_player: Record<string, string[]>;
      truth_sender_ids: string[];
      correctness_by_player_sender: Record<string, Record<string, boolean>>;
      // local-only to make spec timing exact
      remaining_override: string[] | null;
    };

function sortSenderIdsAlpha(senderIds: string[], senders: GameStateSync["senders"]) {
  const m = new Map(senders.map((s) => [s.id_local, s.name]));
  return [...senderIds].sort((a, b) => (m.get(a) || "").localeCompare(m.get(b) || ""));
}

export default function MasterGame() {
  const { roomCode } = useParams();
  const nav = useNavigate();

  const clientRef = useRef<GameClient | null>(null);

  const [st, setSt] = useState<GameStateSync | null>(null);
  const [msg, setMsg] = useState<string>("");

  const [reveal, setReveal] = useState<RevealState>({ active: false });

  useEffect(() => {
    if (!roomCode) return;

    const c = new GameClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      // if server advanced to next item, stop local reveal if mismatch
      if (reveal.active && s.focus_item?.id && s.focus_item.id !== reveal.item_id && s.current_phase !== "REVEAL_SEQUENCE") {
        setReveal({ active: false });
      }
    };

    c.onError = (_code, message) => setMsg(message || "Erreur");

    c.onEvent = (type, payload) => {
      if (type === "game_end") {
        setMsg("Fin de partie");
        return;
      }
      if (type === "round_complete") {
        setMsg("Round terminé");
        return;
      }
      if (type === "voting_started") {
        setMsg("Vote lancé");
        return;
      }
      if (type === "timer_started") {
        setMsg("Timer lancé");
        return;
      }
      if (type === "voting_closed") {
        setMsg("Vote fermé");
        return;
      }

      if (type === "reveal_step") {
        const step = Number(payload?.step || 0);
        const item_id = String(payload?.item_id || "");
        if (!item_id || !step) return;

        setMsg("");

        setReveal((prev) => {
          const base =
            prev.active && prev.item_id === item_id
              ? prev
              : {
                  active: true as const,
                  item_id,
                  step: 0,
                  votes_by_player: {},
                  truth_sender_ids: [],
                  correctness_by_player_sender: {},
                  remaining_override: null
                };

          if (step === 1) {
            return {
              ...base,
              active: true,
              step: 1,
              votes_by_player: payload?.votes_by_player || {},
              // keep what we have for truth/correctness
              truth_sender_ids: base.truth_sender_ids || [],
              correctness_by_player_sender: base.correctness_by_player_sender || {},
              remaining_override: base.remaining_override
            };
          }

          if (step === 2) {
            return {
              ...base,
              active: true,
              step: 2,
              truth_sender_ids: payload?.truth_sender_ids || base.truth_sender_ids,
              remaining_override: base.remaining_override
            };
          }

          if (step === 3) {
            return {
              ...base,
              active: true,
              step: 3,
              correctness_by_player_sender: payload?.correctness_by_player_sender || base.correctness_by_player_sender,
              remaining_override: base.remaining_override
            };
          }

          if (step === 4) {
            return { ...base, active: true, step: 4, remaining_override: base.remaining_override };
          }

          if (step === 5) {
            // remove truth from remaining immediately (spec step 5)
            const truth = payload?.truth_sender_ids || base.truth_sender_ids || [];
            const curRemaining = st?.remaining_senders || [];
            const nextRemaining = curRemaining.filter((id) => !truth.includes(id));
            return { ...base, active: true, step: 5, truth_sender_ids: truth, remaining_override: nextRemaining };
          }

          if (step === 6) {
            // cleanup (spec step 6)
            return { active: false };
          }

          return { ...base, active: true, step };
        });

        return;
      }
    };

    (async () => {
      try {
        await c.connect(String(roomCode), "master");
        c.attachStateCache();
        await c.masterReady();
      } catch {
        setMsg("Connexion impossible");
      }
    })();

    return () => c.ws.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  const focus = st?.focus_item || null;
  const focusUrl = (focus as any)?.reel_url as string | undefined;

  const canOpen = !!focus && !!focusUrl && st?.phase === "IN_GAME" && !focus.resolved;
  const canStartVoting =
    !!focus && st?.phase === "IN_GAME" && !focus.resolved && ["ROUND_INIT", "OPEN_REEL"].includes(st.current_phase);
  const canStartTimer =
    !!focus && st?.phase === "IN_GAME" && !focus.resolved && ["VOTING", "TIMER_RUNNING"].includes(st.current_phase);

  const sendersById = useMemo(() => {
    const m = new Map<string, GameStateSync["senders"][number]>();
    (st?.senders || []).forEach((s) => m.set(s.id_local, s));
    return m;
  }, [st?.senders]);

  const displayedRemainingIds = useMemo(() => {
    if (!st) return [];
    if (reveal.active && reveal.remaining_override) return reveal.remaining_override;
    return st.remaining_senders || [];
  }, [st, reveal]);

  const displayedRemaining = useMemo(() => {
    if (!st) return [];
    const ids = displayedRemainingIds;
    return ids.map((id) => sendersById.get(id)).filter(Boolean) as any[];
  }, [displayedRemainingIds, sendersById, st]);

  const highlightTruthSet = useMemo(() => {
    if (!reveal.active) return new Set<string>();
    // highlight at step 2+ (spec)
    if (reveal.step >= 2 && reveal.truth_sender_ids?.length) return new Set(reveal.truth_sender_ids);
    return new Set<string>();
  }, [reveal]);

  // Local truth slots per item (only known after step5 for each item)
  const [truthByItem, setTruthByItem] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!reveal.active) return;
    if (reveal.step !== 5) return;
    if (!st) return;
    const itemId = reveal.item_id;
    const truthSorted = sortSenderIdsAlpha(reveal.truth_sender_ids || [], st.senders);
    setTruthByItem((prev) => ({ ...prev, [itemId]: truthSorted }));
  }, [reveal, st]);

  // Clear truth cache when new room / full refresh (simple)
  useEffect(() => {
    if (!st) return;
    // if indices reset or room changes, keep minimal: if round index decreased, clear.
    // MVP: clear on room_code change only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.room_code]);

  const orderedRoundItems = useMemo(() => st?.round?.items || [], [st]);

  const focusIndex = useMemo(() => {
    if (!st?.round?.items || !st.focus_item?.id) return 0;
    const i = st.round.items.findIndex((x) => x.id === st.focus_item?.id);
    return i >= 0 ? i : 0;
  }, [st]);

  // Pancartes (step1..5)
  const showPlacards = reveal.active && reveal.step >= 1 && reveal.step <= 5;
  const showPlacardScale = reveal.active && reveal.step >= 3 && reveal.step <= 5;

  function senderName(id: string) {
    return sendersById.get(id)?.name || "—";
  }
  function senderPhoto(id: string) {
    return sendersById.get(id)?.photo_url || null;
  }

  if (!st) return <div className={styles.root}>Connexion…</div>;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <div className={styles.k}>Room</div>
          <div className={styles.v}>{st.room_code}</div>
        </div>
        <div>
          <div className={styles.k}>Phase</div>
          <div className={styles.v}>{st.current_phase}</div>
        </div>
        <div>
          <div className={styles.k}>Timer</div>
          <div className={styles.v}>{st.timer_end_ts ? "ON" : "—"}</div>
        </div>
      </div>

      {/* Zone A — Panel Round (focus + minis) */}
      <div className={styles.panel}>
        <div className={styles.panelTitle}>
          Round {st.current_round_index + 1} · Item {st.current_item_index + 1}/{orderedRoundItems.length || 1}
        </div>

        <div className={styles.tiles}>
          <div className={styles.focusTile}>
            <div className={styles.tileTop}>
              <div className={styles.tileTitle}>Focus</div>
              <div className={styles.tileMeta}>
                k={focus?.k ?? 0} · {focus?.opened ? "opened" : "unopened"} · {focus?.resolved ? "resolved" : "active"}
              </div>
            </div>

            <div className={styles.actions}>
              <button
                className={styles.primary}
                disabled={!canOpen}
                onClick={() => {
                  if (!focusUrl) return;
                  window.open(focusUrl, "_blank", "noopener,noreferrer");
                  clientRef.current?.openReel();
                }}
              >
                Ouvrir
              </button>

              <button className={styles.primary} disabled={!canStartVoting} onClick={() => clientRef.current?.startVoting()}>
                Lancer le vote
              </button>

              <button className={styles.primary} disabled={!canStartTimer} onClick={() => clientRef.current?.startTimer(10)}>
                Lancer 10s
              </button>
            </div>

            <div className={styles.slotsRow}>
              {Array.from({ length: focus?.k || 0 }).map((_, i) => {
                const truth = focus?.id ? truthByItem[focus.id] : null;
                const sid = truth?.[i] || null;
                return (
                  <div key={i} className={`${styles.slot} ${sid ? styles.slotFilled : styles.slotEmpty}`}>
                    {sid ? (
                      <div className={styles.slotBadge}>
                        <div className={styles.slotAvatar}>
                          {senderPhoto(sid) ? <img src={senderPhoto(sid)!} alt="" /> : null}
                        </div>
                        <div className={styles.slotName}>{senderName(sid)}</div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className={styles.msg}>{msg || "—"}</div>
          </div>

          <div className={styles.miniGrid}>
            {orderedRoundItems.map((it, idx) => {
              const isFocus = idx === focusIndex;
              const truth = truthByItem[it.id] || null;

              return (
                <div
                  key={it.id}
                  className={`${styles.miniTile} ${isFocus ? styles.miniFocus : ""} ${it.resolved ? styles.miniResolved : ""}`}
                  title={`k=${it.k} ${it.opened ? "opened" : ""} ${it.resolved ? "resolved" : ""}`}
                >
                  <div className={styles.miniTop}>
                    <div className={styles.miniI}>{idx + 1}</div>
                    <div className={styles.miniK}>k={it.k}</div>
                  </div>

                  <div className={styles.miniSlots}>
                    {Array.from({ length: it.k }).map((_, i2) => {
                      const sid = truth?.[i2] || null;
                      return (
                        <div key={i2} className={`${styles.miniSlot} ${sid ? styles.miniSlotFilled : styles.miniSlotEmpty}`}>
                          {sid ? (
                            <div className={styles.miniSlotAvatar}>
                              {senderPhoto(sid) ? <img src={senderPhoto(sid)!} alt="" /> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Zone B — Senders restants (round scope) */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Senders restants</div>
        <div className={styles.badges}>
          {displayedRemaining.map((s: any) => {
            const hl = highlightTruthSet.has(s.id_local);
            return (
              <div key={s.id_local} className={`${styles.badge} ${hl ? styles.badgeHighlight : ""}`}>
                <div className={styles.badgeAvatar}>{s.photo_url ? <img src={s.photo_url} alt="" /> : null}</div>
                <div className={styles.badgeName}>{s.name}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Zone C — Players + pancartes */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Players</div>

        <div className={styles.players}>
          {[...st.players]
            .filter((p) => p.active)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => {
              const sel = showPlacards ? reveal.active ? reveal.votes_by_player[p.id] || [] : [] : [];
              return (
                <div key={p.id} className={styles.playerBlock}>
                  {/* placards line (above player) */}
                  <div className={styles.placards}>
                    {showPlacards
                      ? sel.map((sid) => {
                          const ok = reveal.active ? !!reveal.correctness_by_player_sender?.[p.id]?.[sid] : false;
                          const scaleClass = showPlacardScale ? (ok ? styles.placardCorrect : styles.placardWrong) : "";
                          return (
                            <div key={`${p.id}_${sid}`} className={`${styles.placard} ${scaleClass}`}>
                              <div className={styles.placardAvatar}>{senderPhoto(sid) ? <img src={senderPhoto(sid)!} alt="" /> : null}</div>
                              <div className={styles.placardName}>{senderName(sid)}</div>
                              <div className={styles.placardArrow} />
                            </div>
                          );
                        })
                      : null}
                  </div>

                  <div className={styles.player}>
                    <div className={styles.playerAvatar}>{p.photo_url ? <img src={p.photo_url} alt="" /> : null}</div>
                    <div className={styles.playerName}>{p.name}</div>
                    <div className={styles.playerScore}>{p.score}</div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <button className={styles.back} onClick={() => nav("/master/setup")}>
        Retour
      </button>
    </div>
  );
}
