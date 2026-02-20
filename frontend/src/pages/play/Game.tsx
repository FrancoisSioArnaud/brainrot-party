import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styles from "./Game.module.css";
import { GameClient, GameStateSync } from "../../ws/gameClient";
import { clearPlaySession, getPlaySession, setOneShotError } from "../../utils/playSession";

export default function PlayGame() {
  const { roomCode } = useParams();
  const nav = useNavigate();

  const session = useMemo(() => getPlaySession(), []);
  const player_id = session?.player_id || null;

  const clientRef = useRef<GameClient | null>(null);
  const [st, setSt] = useState<GameStateSync | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [localMsg, setLocalMsg] = useState<string>("");

  useEffect(() => {
    if (!roomCode) return;
    if (!player_id) {
      setOneShotError("Sélectionne un player");
      nav("/play", { replace: true });
      return;
    }

    const c = new GameClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);

      // reset selection when item changes
      const focusId = s.focus_item?.id;
      if (!focusId) return;
      const existing = s.votes_for_focus?.[player_id] || null;
      if (existing) setSelected(existing);
      else setSelected([]);
    };

    c.onError = (_code, message) => {
      clearPlaySession();
      setOneShotError(message || "Room introuvable");
      nav("/play", { replace: true });
    };

    (async () => {
      try {
        await c.connect(String(roomCode), "play");
        await c.playReady(player_id);
      } catch {
        clearPlaySession();
        setOneShotError("Room introuvable");
        nav("/play", { replace: true });
      }
    })();

    return () => c.ws.disconnect();
  }, [roomCode, nav, player_id]);

  const focus = st?.focus_item;
  const k = focus?.k || 0;

  const sendersActive = useMemo(() => (st?.senders || []).filter((s) => s.active), [st]);

  const inVoting = st?.current_phase === "VOTING" || st?.current_phase === "TIMER_RUNNING";
  const canVote = !!focus && inVoting && (st?.phase === "IN_GAME");

  const secondsLeft = useMemo(() => {
    if (!st?.timer_end_ts) return null;
    return Math.max(0, Math.ceil((st.timer_end_ts - Date.now()) / 1000));
  }, [st?.timer_end_ts, st?.current_phase, st?.current_item_index]);

  function toggle(id_local: string) {
    if (!canVote) return;
    setLocalMsg("");

    setSelected((prev) => {
      const has = prev.includes(id_local);
      if (has) return prev.filter((x) => x !== id_local);
      if (prev.length >= k) return prev; // UI prevents >k
      return [...prev, id_local];
    });
  }

  async function submit() {
    if (!canVote || !player_id || !focus) return;
    if (selected.length < k) {
      setLocalMsg(`Sélectionne encore ${k - selected.length}`);
      return;
    }
    setLocalMsg("");
    await clientRef.current?.castVote(player_id, selected);
    setLocalMsg("Vote envoyé");
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
      </div>

      {canVote ? (
        <div className={styles.card}>
          <div className={styles.cardTitle}>{k} users à sélectionner</div>

          {secondsLeft != null ? (
            <div className={styles.note}>Timer: {secondsLeft}s</div>
          ) : null}

          <div className={styles.grid}>
            {sendersActive.map((s) => {
              const isSel = selected.includes(s.id_local);
              return (
                <button
                  key={s.id_local}
                  className={`${styles.senderBtn} ${isSel ? styles.senderSelected : ""}`}
                  onClick={() => toggle(s.id_local)}
                >
                  <div className={styles.senderName}>{s.name}</div>
                  <div className={styles.senderSub}>{isSel ? "Sélectionné" : "—"}</div>
                </button>
              );
            })}
          </div>

          <button className={styles.primary} onClick={submit}>
            Voter
          </button>

          {localMsg ? <div className={styles.msg}>{localMsg}</div> : null}
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.cardTitle}>En attente</div>
          <div className={styles.note}>En attente du prochain vote</div>
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.cardTitle}>Leaderboard</div>
        <div className={styles.list}>
          {[...st.players]
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .map((p) => (
              <div key={p.id} className={styles.row}>
                <div className={styles.name}>{p.name}</div>
                <div className={styles.score}>{p.score}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
