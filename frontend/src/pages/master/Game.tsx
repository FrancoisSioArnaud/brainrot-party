import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GameClient, GameStateSync } from "../../ws/gameClient";
import styles from "./Game.module.css";

export default function MasterGame() {
  const { roomCode } = useParams();
  const nav = useNavigate();

  const clientRef = useRef<GameClient | null>(null);
  const [st, setSt] = useState<GameStateSync | null>(null);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    if (!roomCode) return;

    const c = new GameClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setMsg("");
    };

    c.onError = (_code, message) => {
      setMsg(message || "Erreur");
    };

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
      if (type === "reveal_step") {
        setMsg("");
        return;
      }
      if (type === "voting_closed") {
        setMsg("Vote fermé");
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
  }, [roomCode]);

  const focus = st?.focus_item || null;

  const focusUrl = (focus as any)?.reel_url as string | undefined;
  const canOpen = !!focus && !!focusUrl && st?.phase === "IN_GAME" && !focus.resolved;
  const canStartVoting = !!focus && st?.phase === "IN_GAME" && !focus.resolved && ["ROUND_INIT", "OPEN_REEL"].includes(st.current_phase);
  const canStartTimer = !!focus && st?.phase === "IN_GAME" && !focus.resolved && ["VOTING", "TIMER_RUNNING"].includes(st.current_phase);

  const remaining = useMemo(() => {
    if (!st) return [];
    const map = new Map(st.senders.map(s => [s.id_local, s]));
    return (st.remaining_senders || [])
      .map(id => map.get(id))
      .filter(Boolean)
      .map(s => s!);
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
          <div className={styles.k}>Timer</div>
          <div className={styles.v}>{st.timer_end_ts ? "ON" : "—"}</div>
        </div>
      </div>

      {/* Zone A: Focus + minis */}
      <div className={styles.panel}>
        <div className={styles.panelTitle}>Round {st.current_round_index + 1}</div>

        <div className={styles.tiles}>
          <div className={styles.focusTile}>
            <div className={styles.tileTop}>
              <div className={styles.tileTitle}>Item {st.current_item_index + 1}</div>
              <div className={styles.tileMeta}>
                k={focus?.k ?? 0} · {focus?.opened ? "opened" : "unopened"} ·{" "}
                {focus?.resolved ? "resolved" : "active"}
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

              <button
                className={styles.primary}
                disabled={!canStartVoting}
                onClick={() => clientRef.current?.startVoting()}
              >
                Lancer le vote
              </button>

              <button
                className={styles.primary}
                disabled={!canStartTimer}
                onClick={() => clientRef.current?.startTimer(10)}
              >
                Lancer 10s
              </button>
            </div>

            <div className={styles.msg}>{msg || "—"}</div>
          </div>

          <div className={styles.miniGrid}>
            {(st.round?.items || []).map((it, idx) => {
              const isFocus = it.id === focus?.id;
              return (
                <div
                  key={it.id}
                  className={`${styles.miniTile} ${isFocus ? styles.miniFocus : ""} ${
                    it.resolved ? styles.miniResolved : ""
                  }`}
                  title={`k=${it.k} ${it.opened ? "opened" : ""} ${it.resolved ? "resolved" : ""}`}
                >
                  <div className={styles.miniK}>k={it.k}</div>
                  <div className={styles.miniI}>{idx + 1}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Zone B: Remaining senders */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Senders restants</div>
        <div className={styles.badges}>
          {remaining.map((s) => (
            <div key={s.id_local} className={styles.badge}>
              <div className={styles.badgeAvatar}>
                {s.photo_url ? <img src={s.photo_url} alt="" /> : null}
              </div>
              <div className={styles.badgeName}>{s.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Zone C: Players */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>Players</div>
        <div className={styles.players}>
          {[...st.players]
            .filter(p => p.active)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <div key={p.id} className={styles.player}>
                <div className={styles.playerAvatar}>
                  {p.photo_url ? <img src={p.photo_url} alt="" /> : null}
                </div>
                <div className={styles.playerName}>{p.name}</div>
                <div className={styles.playerScore}>{p.score}</div>
              </div>
            ))}
        </div>
      </div>

      <button className={styles.back} onClick={() => nav("/master/setup")}>
        Retour
      </button>
    </div>
  );
}
