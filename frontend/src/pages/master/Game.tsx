import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GameClient, GameStateSync } from "../../ws/gameClient";
import styles from "./Game.module.css";
import { toast } from "../../components/common/Toast";

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
          <div className={styles.v}>{st.phase}</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Players</div>
        <div className={styles.list}>
          {playersSorted.map((p) => (
            <div key={p.id} className={styles.row}>
              <div className={styles.name}>
                {p.active ? "" : "(désactivé) "} {p.name}
              </div>
              <div className={styles.score}>{p.score}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Senders actifs</div>
        <div className={styles.tags}>
          {st.senders
            .filter((s) => s.active)
            .map((s) => (
              <span className={styles.tag} key={s.id_local}>
                {s.name}
              </span>
            ))}
        </div>
      </div>

      <div className={styles.note}>
        MVP: cette page affiche seulement <code>state_sync</code>. Les rounds/votes arrivent à l’étape suivante.
      </div>
    </div>
  );
}
