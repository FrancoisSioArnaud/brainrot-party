import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styles from "./Game.module.css";
import { toast } from "../../components/common/Toast";
import { GameClient, GameStateSync } from "../../ws/gameClient";
import ReelsPanel from "../../components/master/game/ReelsPanel";
import RemainingSenders from "../../components/master/game/RemainingSenders";
import PlayersPanel from "../../components/master/game/PlayersPanel";

type RevealRuntime = {
  step: number; // 0..6
  item_id: string | null;
  votes_by_player: Record<string, string[]> | null;
  truth_sender_ids: string[] | null;
  correctness_by_player_sender: Record<string, Record<string, boolean>> | null;
};

export default function MasterGame() {
  const { roomCode } = useParams();
  const nav = useNavigate();

  const clientRef = useRef<GameClient | null>(null);
  const [st, setSt] = useState<GameStateSync | null>(null);

  // runtime reveal state (derived from events)
  const [reveal, setReveal] = useState<RevealRuntime>({
    step: 0,
    item_id: null,
    votes_by_player: null,
    truth_sender_ids: null,
    correctness_by_player_sender: null,
  });

  // local-only cache of truths per item (for slots rendering after step5)
  const truthCacheRef = useRef<Map<string, string[]>>(new Map());

  // highlight truth in remaining zone at step2
  const highlightedTruth = useMemo(() => {
    if (reveal.step >= 2 && reveal.step < 5 && reveal.truth_sender_ids) return new Set(reveal.truth_sender_ids);
    return new Set<string>();
  }, [reveal.step, reveal.truth_sender_ids]);

  // show placards only during reveal sequence steps 1..5
  const showPlacards = reveal.step >= 1 && reveal.step <= 5;

  useEffect(() => {
    if (!roomCode) return;

    const c = new GameClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);

      // if focus item changed, reset reveal runtime unless currently revealing this same item
      const focusId = s.focus_item?.id || null;
      setReveal((prev) => {
        if (!focusId) return { step: 0, item_id: null, votes_by_player: null, truth_sender_ids: null, correctness_by_player_sender: null };
        if (prev.item_id && prev.item_id === focusId && prev.step > 0 && prev.step < 6) return prev;
        return { step: 0, item_id: focusId, votes_by_player: null, truth_sender_ids: null, correctness_by_player_sender: null };
      });
    };

    c.onEvent = (type, payload) => {
      if (type === "reveal_step") {
        const step = Number(payload?.step || 0);

        setReveal((prev) => {
          const itemId = st?.focus_item?.id || prev.item_id || null;

          if (step === 1) {
            return {
              step: 1,
              item_id: itemId,
              votes_by_player: payload?.votes_by_player || {},
              truth_sender_ids: null,
              correctness_by_player_sender: null,
            };
          }
          if (step === 2) {
            return {
              ...prev,
              step: 2,
              truth_sender_ids: Array.isArray(payload?.truth_sender_ids) ? payload.truth_sender_ids : [],
            };
          }
          if (step === 3) {
            return {
              ...prev,
              step: 3,
              correctness_by_player_sender: payload?.correctness_by_player_sender || {},
            };
          }
          if (step === 4) {
            return { ...prev, step: 4 };
          }
          if (step === 5) {
            const truth = Array.isArray(payload?.truth_sender_ids) ? payload.truth_sender_ids : [];
            if (itemId) truthCacheRef.current.set(itemId, truth);
            return { ...prev, step: 5, truth_sender_ids: truth };
          }
          if (step === 6) {
            return { step: 0, item_id: itemId, votes_by_player: null, truth_sender_ids: null, correctness_by_player_sender: null };
          }
          return prev;
        });

        return;
      }

      if (type === "game_end") {
        toast("Partie terminée");
        return;
      }
    };

    c.onError = (_code, message) => {
      toast(message);
      nav("/master/setup", { replace: true });
    };

    (async () => {
      try {
        await c.connect(String(roomCode), "master");
        await c.masterReady();
      } catch {
        toast("Room introuvable");
        nav("/master/setup", { replace: true });
      }
    })();

    return () => c.ws.disconnect();
  }, [roomCode, nav, st?.focus_item?.id]);

  const focus = st?.focus_item || null;
  const focusTruth = useMemo(() => {
    if (!focus?.id) return [];
    return truthCacheRef.current.get(focus.id) || (reveal.step >= 5 ? (reveal.truth_sender_ids || []) : []);
  }, [focus?.id, reveal.step, reveal.truth_sender_ids]);

  const timerSecondsLeft = useMemo(() => {
    if (!st?.timer_end_ts) return null;
    return Math.max(0, Math.ceil((st.timer_end_ts - Date.now()) / 1000));
  }, [st?.timer_end_ts, st?.current_phase, st?.current_item_index]);

  if (!st) return <div className={styles.root}>Connexion…</div>;

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <div className={styles.topItem}>
          <div className={styles.k}>Room</div>
          <div className={styles.v}>{st.room_code}</div>
        </div>

        <div className={styles.topItem}>
          <div className={styles.k}>Phase</div>
          <div className={styles.v}>{st.current_phase}</div>
        </div>

        <div className={styles.topItem}>
          <div className={styles.k}>Timer</div>
          <div className={styles.v}>{timerSecondsLeft == null ? "—" : `${timerSecondsLeft}s`}</div>
        </div>

        <div className={styles.topItem}>
          <div className={styles.k}>Round</div>
          <div className={styles.v}>
            {st.round ? `${st.current_round_index + 1} / ${st.current_round_index + 1}` : "—"}
          </div>
        </div>
      </div>

      {/* Zone A — Panel Round */}
      <div className={styles.zoneA}>
        <ReelsPanel
          state={st}
          revealStep={reveal.step}
          focusTruthSenderIds={focusTruth}
          onOpen={() => {
            if (!focus?.reel_url) return;
            window.open(focus.reel_url, "_blank", "noopener,noreferrer");
            clientRef.current?.openReel();
          }}
          onStartVoting={() => clientRef.current?.startVoting()}
          onStartTimer={() => clientRef.current?.startTimer(10)}
          onForceClose={() => clientRef.current?.forceCloseVoting()}
        />
      </div>

      {/* Zone B — Senders restants */}
      <div className={styles.zoneB}>
        <RemainingSenders
          senders={st.senders}
          remainingIds={st.remaining_senders}
          highlightedTruth={highlightedTruth}
        />
      </div>

      {/* Zone C — Players + pancartes */}
      <div className={styles.zoneC}>
        <PlayersPanel
          players={st.players}
          senders={st.senders}
          showPlacards={showPlacards}
          k={focus?.k || 0}
          votesByPlayer={reveal.votes_by_player || {}}
          correctnessByPlayerSender={reveal.correctness_by_player_sender || {}}
          revealStep={reveal.step}
        />
      </div>
    </div>
  );
}
