import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { GameClient, GameStateSync } from "../../ws/gameClient";
import styles from "./Game.module.css";

function nowMs() {
  return Date.now();
}

function readPlayerId(): string | null {
  // MVP: you should already store this after lobby claim
  return (
    localStorage.getItem("brp_player_id") ||
    localStorage.getItem("brp_play_player_id") ||
    null
  );
}

export default function PlayGame() {
  const { roomCode } = useParams();
  const nav = useNavigate();

  const clientRef = useRef<GameClient | null>(null);
  const [st, setSt] = useState<GameStateSync | null>(null);
  const [error, setError] = useState<string>("");

  const playerId = useMemo(() => readPlayerId(), []);

  const [selected, setSelected] = useState<string[]>([]);
  const [uiMsg, setUiMsg] = useState<string>("");

  // timer local tick
  const [tick, setTick] = useState<number>(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, []);

  const phase = st?.current_phase || "—";
  const focusId = st?.focus_item?.id || null;
  const k = st?.focus_item?.k || 0;

  const isVoting = phase === "VOTING" || phase === "TIMER_RUNNING";
  const isReveal = phase === "REVEAL_SEQUENCE";
  const isWait = !isVoting; // OPEN_REEL / ROUND_INIT / REVEAL / etc.

  // active senders only
  const activeSenders = useMemo(() => {
    if (!st) return [];
    return st.senders.filter((s) => s.active);
  }, [st]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // When focus item changes, reset selection & message
  useEffect(() => {
    setSelected([]);
    setUiMsg("");
  }, [focusId]);

  // Timer countdown text
  const timerEnd = st?.timer_end_ts ?? null;
  const secondsLeft = useMemo(() => {
    if (!timerEnd) return null;
    const ms = timerEnd - nowMs();
    return Math.max(0, Math.ceil(ms / 1000));
  }, [timerEnd, tick]);

  const missing = Math.max(0, k - selected.length);

  // Manual submit rules (spec): refuse if <k
  const canSubmit = isVoting && k > 0 && selected.length === k;

  // Auto-submit at timer end (partial or empty) (spec)
  useEffect(() => {
    if (!isVoting) return;
    if (!timerEnd) return; // only auto-submit when timer exists
    if (!playerId) return;
    if (!focusId) return;

    if (secondsLeft !== 0) return;

    // If already voted for this focus, do nothing
    const already = st?.votes_for_focus?.[playerId];
    if (already && already.length > 0) return;

    // auto-submit partial (could be empty)
    (async () => {
      try {
        await clientRef.current?.castVote(playerId, selected);
        setUiMsg("Vote envoyé (auto)");
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, isVoting, timerEnd, playerId, focusId]);

  useEffect(() => {
    if (!roomCode) return;

    if (!playerId) {
      setError("player_id manquant (claim le player dans le lobby avant)");
      return;
    }

    const c = new GameClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setError("");
    };

    c.onError = (_code, message) => {
      setError(message || "Erreur");
    };

    c.onEvent = (type, payload) => {
      if (type === "voting_started") {
        setUiMsg("");
        return;
      }
      if (type === "voting_closed") {
        setUiMsg("Vote fermé");
        return;
      }
      if (type === "reveal_step") {
        setUiMsg("");
        return;
      }
      if (type === "game_end") {
        setUiMsg("Fin de partie");
        return;
      }
      if (type === "timer_started") {
        setUiMsg("");
        return;
      }
    };

    (async () => {
      try {
        await c.connect(String(roomCode), "play");
        c.attachStateCache();
        await c.playReady(playerId);
      } catch {
        setError("Connexion impossible");
      }
    })();

    return () => c.ws.disconnect();
  }, [roomCode, playerId]);

  const votedForFocus = useMemo(() => {
    if (!st || !playerId) return false;
    const v = st.votes_for_focus?.[playerId];
    return Array.isArray(v) && v.length > 0;
  }, [st, playerId]);

  function toggleSender(id: string) {
    if (!isVoting) return;

    setUiMsg("");

    setSelected((prev) => {
      const has = prev.includes(id);
      if (has) return prev.filter((x) => x !== id);

      // enforce max k
      if (prev.length >= k) return prev;
      return [...prev, id];
    });
  }

  async function submitVote() {
    if (!playerId) return;
    if (!isVoting) return;

    if (selected.length < k) {
      setUiMsg(`Sélectionne encore ${k - selected.length}`);
      return;
    }

    try {
      await clientRef.current?.castVote(playerId, selected);
      setUiMsg("Vote envoyé");
    } catch {
      setUiMsg("Impossible d’envoyer le vote");
    }
  }

  if (!roomCode) return <div className={styles.root}>roomCode manquant</div>;

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.title}>Erreur</div>
          <div className={styles.text}>{error}</div>
          <button className={styles.btn} onClick={() => nav("/play")}>Retour</button>
        </div>
      </div>
    );
  }

  if (!st) return <div className={styles.root}>Connexion…</div>;

  // WAIT screen (spec): shown during OPEN_REEL / REVEAL / transitions
  if (isWait) {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.title}>
            {isReveal ? "Révélation…" : "En attente du prochain vote"}
          </div>
          <div className={styles.text}>
            {uiMsg || (isReveal ? "Résultats en cours…" : "Le master prépare le prochain reel.")}
          </div>

          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              <div className={styles.metaK}>Phase</div>
              <div className={styles.metaV}>{phase}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // VOTE screen
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.title}>{k} users à sélectionner</div>

        {timerEnd ? (
          <div className={styles.timer}>
            <div className={styles.timerLabel}>Temps restant</div>
            <div className={styles.timerValue}>{secondsLeft}</div>
          </div>
        ) : null}

        <div className={styles.grid}>
          {activeSenders.map((s) => {
            const on = selectedSet.has(s.id_local);
            const disabled = !on && selected.length >= k; // enforce max k
            return (
              <button
                key={s.id_local}
                className={`${styles.sender} ${on ? styles.senderOn : ""}`}
                disabled={disabled || votedForFocus}
                onClick={() => toggleSender(s.id_local)}
              >
                <div className={styles.avatar}>
                  {s.photo_url ? <img src={s.photo_url} alt="" /> : null}
                </div>
                <div className={styles.name}>{s.name}</div>
              </button>
            );
          })}
        </div>

        <div className={styles.footer}>
          <div className={styles.hint}>
            {votedForFocus
              ? "Vote reçu"
              : missing > 0
                ? `Sélectionne encore ${missing}`
                : "Prêt"}
          </div>

          <button className={styles.btn} disabled={!canSubmit || votedForFocus} onClick={submitVote}>
            Voter
          </button>
        </div>

        {uiMsg ? <div className={styles.msg}>{uiMsg}</div> : null}
      </div>
    </div>
  );
}
