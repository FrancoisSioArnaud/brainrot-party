import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styles from "./Game.module.css";
import { toast } from "../../components/common/Toast";
import { GameClient, GameStateSync } from "../../ws/gameClient";

export default function MasterGame() {
  const { roomCode } = useParams();
  const nav = useNavigate();

  const clientRef = useRef<GameClient | null>(null);
  const [st, setSt] = useState<GameStateSync | null>(null);

  useEffect(() => {
    if (!roomCode) return;

    const c = new GameClient();
    clientRef.current = c;

    c.onState = (s) => setSt(s);
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
  }, [roomCode, nav]);

  const focus = st?.focus_item;
  const playersSorted = useMemo(() => {
    const arr = st?.players ? [...st.players] : [];
    arr.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return arr;
  }, [st]);

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

      <div className={styles.card}>
        <div className={styles.cardTitle}>Round {st.current_round_index + 1}</div>

        <div className={styles.controls}>
          <button
            className={styles.btn}
            disabled={!focus || focus.resolved || !focus.reel_url}
            onClick={() => {
              window.open(focus.reel_url!, "_blank", "noopener,noreferrer");
              clientRef.current?.openReel();
            }}
          >
            Ouvrir
          </button>
          <button className={styles.btn} disabled={!focus || focus.resolved} onClick={() => clientRef.current?.startVoting()}>
            Lancer le vote
          </button>
          <button className={styles.btn} disabled={!focus || focus.resolved} onClick={() => clientRef.current?.startTimer(10)}>
            Lancer 10s
          </button>
          <button className={styles.btnSecondary} disabled={!focus || focus.resolved} onClick={() => clientRef.current?.forceCloseVoting()}>
            Fermer vote
          </button>
        </div>

        <div className={styles.note}>
          {focus?.reel_url ? focus.reel_url : "—"}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Players</div>
        <div className={styles.list}>
          {playersSorted.map((p) => (
            <div key={p.id} className={styles.row}>
              <div className={styles.name}>{p.active ? p.name : `(désactivé) ${p.name}`}</div>
              <div className={styles.score}>{p.score}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
