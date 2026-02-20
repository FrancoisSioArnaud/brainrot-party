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
  const [lastEvent, setLastEvent] = useState<string>("");

  useEffect(() => {
    if (!roomCode) return;

    const c = new GameClient();
    clientRef.current = c;

    c.onState = (s) => setSt(s);
    c.onEvent = (t) => setLastEvent(t);
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
  const k = focus?.k || 0;

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
        <div>
          <div className={styles.k}>Event</div>
          <div className={styles.v}>{lastEvent || "—"}</div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Round {st.current_round_index + 1}</div>

        <div className={styles.tiles}>
          {(st.round?.items || []).map((it, idx) => {
            const isFocus = idx === st.current_item_index;
            return (
              <div key={it.id} className={`${styles.tile} ${isFocus ? styles.focus : ""}`}>
                <div className={styles.tileTop}>
                  <div className={styles.badge}>
                    {it.resolved ? "Résolu" : it.opened ? "Ouvert" : "À ouvrir"}
                  </div>
                  <div className={styles.small}>k={it.k}</div>
                </div>
                <div className={styles.slotRow}>
                  {Array.from({ length: it.k }).map((_, i) => (
                    <div key={i} className={styles.slot} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.controls}>
          <button className={styles.btn} onClick={() => clientRef.current?.openReel()} disabled={!focus || focus.resolved}>
            Ouvrir
          </button>
          <button className={styles.btn} onClick={() => clientRef.current?.startVoting()} disabled={!focus || focus.resolved}>
            Lancer le vote
          </button>
          <button className={styles.btn} onClick={() => clientRef.current?.startTimer(10)} disabled={!focus || focus.resolved}>
            Lancer 10s
          </button>
          <button className={styles.btnSecondary} onClick={() => clientRef.current?.forceCloseVoting()} disabled={!focus || focus.resolved}>
            Fermer vote
          </button>

          {st.timer_end_ts ? (
            <div className={styles.timer}>
              Timer: {Math.max(0, Math.ceil((st.timer_end_ts - Date.now()) / 1000))}s
            </div>
          ) : (
            <div className={styles.timer}>k: {k}</div>
          )}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Senders restants</div>
        <div className={styles.tags}>
          {st.remaining_senders.map((id) => {
            const s = st.senders.find((x) => x.id_local === id);
            return (
              <span className={styles.tag} key={id}>
                {s?.name || id}
              </span>
            );
          })}
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

      <div className={styles.note}>
        Placeholder: les reels sont “virtualisés”. Quand tu persistes les ReelItems depuis Setup, tu remplaces la
        construction des rounds côté serveur.
      </div>
    </div>
  );
}
