import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GameClient, GameStateSync } from "../../ws/gameClient";
import styles from "./Game.module.css";
import { clearPlaySession, getPlaySession, setOneShotError } from "../../utils/playSession";

export default function PlayGame() {
  const { roomCode } = useParams();
  const nav = useNavigate();

  const session = useMemo(() => getPlaySession(), []);
  const player_id = session?.player_id || null;

  const clientRef = useRef<GameClient | null>(null);
  const [st, setSt] = useState<GameStateSync | null>(null);
  const [meName, setMeName] = useState<string>("");

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
      const me = s.players.find((p) => p.id === player_id);
      setMeName(me?.name || "");
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

  const leaderboard = useMemo(() => {
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
          <div className={styles.k}>Moi</div>
          <div className={styles.v}>{meName || "—"}</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Leaderboard</div>
        <div className={styles.list}>
          {leaderboard.map((p) => (
            <div key={p.id} className={styles.row}>
              <div className={styles.name}>{p.name}</div>
              <div className={styles.score}>{p.score}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.note}>
        MVP: affichage uniquement. Le vote arrive à l’étape suivante.
      </div>
    </div>
  );
}
