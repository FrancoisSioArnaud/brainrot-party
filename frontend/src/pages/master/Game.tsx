// frontend/src/pages/master/Game.tsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { GameClient, GameStateSync } from "../../ws/gameClient";
import styles from "./Game.module.css";

export default function MasterGame() {
  const nav = useNavigate();
  const { roomCode } = useParams();

  const clientRef = useRef<GameClient | null>(null);

  const [state, setState] = useState<GameStateSync | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!roomCode) {
      setError("roomCode manquant");
      return;
    }

    const c = new GameClient();
    clientRef.current = c;

    // ✅ onState est une propriété callback (pas une fonction)
    c.onState = (s) => {
      setState(s);
      setError("");
    };

    c.onError = (_code, message) => {
      setError(message || "Erreur");
    };

    c.onEvent = () => {
      // no-op (minimal)
    };

    (async () => {
      try {
        await c.connect(String(roomCode), "master");
        c.attachStateCache();
        await c.masterReady();
      } catch {
        setError("Connexion impossible");
      }
    })();

    return () => {
      try {
        c.ws.disconnect();
      } catch {}
      clientRef.current = null;
    };
  }, [roomCode]);

  async function openReel() {
    try {
      await clientRef.current?.openReel();
    } catch {
      setError("Impossible d’ouvrir le reel");
    }
  }

  async function startVoting() {
    try {
      await clientRef.current?.startVoting();
    } catch {
      setError("Impossible de lancer le vote");
    }
  }

  async function startTimer10() {
    try {
      await clientRef.current?.startTimer(10);
    } catch {
      setError("Impossible de lancer le timer");
    }
  }

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.title}>Erreur</div>
          <div className={styles.text}>{error}</div>
          <button className={styles.btn} onClick={() => nav("/master/lobby")}>
            Retour
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return <div className={styles.root}>Connexion…</div>;
  }

  const focus = state.focus_item;
  const phase = state.current_phase || state.phase;

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.title}>Master Game</div>

        <div className={styles.metaRow}>
          <div className={styles.metaItem}>
            <div className={styles.metaK}>Room</div>
            <div className={styles.metaV}>{state.room_code}</div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaK}>Phase</div>
            <div className={styles.metaV}>{phase}</div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaK}>Round</div>
            <div className={styles.metaV}>{state.current_round_index}</div>
          </div>
          <div className={styles.metaItem}>
            <div className={styles.metaK}>Item</div>
            <div className={styles.metaV}>{state.current_item_index}</div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Item focus</div>
          {focus ? (
            <div className={styles.text}>
              id: {focus.id} — k: {focus.k} — opened: {String(focus.opened)} — resolved:{" "}
              {String(focus.resolved)}
            </div>
          ) : (
            <div className={styles.text}>—</div>
          )}
        </div>

        <div className={styles.row}>
          <button className={styles.btn} onClick={openReel} disabled={!focus}>
            Ouvrir
          </button>
          <button className={styles.btn} onClick={startVoting} disabled={!focus}>
            Lancer vote
          </button>
          <button className={styles.btn} onClick={startTimer10} disabled={!focus}>
            Timer 10s
          </button>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Players</div>
          <div className={styles.leaderboard}>
            {[...state.players]
              .filter((p) => p.active)
              .sort((a, b) => (b.score || 0) - (a.score || 0))
              .map((p) => (
                <div key={p.id} className={styles.leaderRow}>
                  <div className={styles.leaderAvatar}>
                    {p.photo_url ? <img src={p.photo_url} alt="" /> : null}
                  </div>
                  <div className={styles.leaderName}>{p.name}</div>
                  <div className={styles.leaderScore}>{p.score}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
