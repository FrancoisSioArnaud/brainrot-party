// frontend/src/pages/master/Game.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import styles from "./Game.module.css";

import PlayersPanel from "../../components/master/game/PlayersPanel";
import ReelsPanel from "../../components/master/game/ReelsPanel";
import RemainingSenders from "../../components/master/game/RemainingSenders";

import { GameClient, GameStateSync } from "../../ws/gameClient";
import { toast } from "../../components/common/Toast";

export default function MasterGame() {
  const { roomCode } = useParams();
  const nav = useNavigate();

  const clientRef = useRef<GameClient | null>(null);

  const [st, setSt] = useState<GameStateSync | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!roomCode) return;

    const c = new GameClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setError("");
    };

    c.onError = (_code, message) => {
      setError(message || "Erreur");
    };

    // Backend n’émet pas encore reveal_step => on ignore tout ça ici.
    c.onEvent = (type, _payload) => {
      if (type === "game_end") toast("Fin de partie");
    };

    (async () => {
      try {
        await c.connect(String(roomCode), "master");
        c.attachStateCache();
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

  if (!roomCode) return <div className={styles.root}>roomCode manquant</div>;

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Erreur</div>
          <div style={{ fontWeight: 900, opacity: 0.9 }}>{error}</div>
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button className={styles.primary} onClick={() => nav("/master/setup", { replace: true })}>
              Retour setup
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!st) return <div className={styles.root}>Connexion…</div>;

  const k = st.focus_item?.k || 0;

  // Tant que reveal_step n’existe pas, on force revealStep=0
  const revealStep = 0;

  const showPlacards = useMemo(() => {
    const p = st.current_phase;
    return p === "VOTING" || p === "TIMER_RUNNING" || p === "REVEAL_SEQUENCE";
  }, [st.current_phase]);

  const remainingIds = useMemo(() => st.remaining_senders || [], [st.remaining_senders]);

  // Backend ne fournit pas encore "truth highlight" en steps => vide
  const highlightedTruth = useMemo(() => new Set<string>(), []);

  // Backend ne fournit pas encore "truth slots" => vide
  const focusTruthSenderIds = useMemo(() => [] as string[], []);

  // Pancartes basées sur ce que le backend envoie déjà dans state_sync
  const votesByPlayer = st.votes_for_focus || {};

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
          <div className={styles.k}>Round</div>
          <div className={styles.v}>{st.current_round_index + 1}</div>
        </div>
        <div>
          <div className={styles.k}>Item</div>
          <div className={styles.v}>{st.current_item_index + 1}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <button className={styles.primary} onClick={() => nav("/master/lobby")}>
            Lobby
          </button>
          <button className={styles.primary} onClick={() => nav("/master/setup")}>
            Setup
          </button>
        </div>
      </div>

      <div className={styles.tiles}>
        <div className={styles.panel}>
          <div className={styles.panelTitle}>Reels</div>

          <ReelsPanel
            state={st}
            revealStep={revealStep}
            focusTruthSenderIds={focusTruthSenderIds}
            onOpen={async () => {
              const itemId = st.focus_item?.id;
              const url = st.focus_item?.reel_url; // master only
              if (!itemId) return toast("Item manquant");
              if (!url) return toast("URL manquante (master only)");

              window.open(url, "_blank", "noopener,noreferrer");

              try {
                // backend attend { item_id }
                await clientRef.current?.openReel(itemId);
              } catch {
                toast("Impossible de démarrer");
              }
            }}
            onStartTimer={async () => {
              try {
                await clientRef.current?.startTimer(10);
              } catch {
                toast("Impossible de lancer le timer");
              }
            }}
            onForceClose={async () => {
              try {
                await clientRef.current?.forceCloseVoting();
              } catch {
                toast("Impossible de fermer");
              }
            }}
          />
        </div>

        <div className={styles.panel}>
          <PlayersPanel
            players={st.players}
            senders={st.senders}
            showPlacards={showPlacards}
            k={k}
            votesByPlayer={votesByPlayer}
            correctnessByPlayerSender={{}}
            revealStep={revealStep}
          />
        </div>
      </div>

      <div className={styles.panel}>
        <RemainingSenders senders={st.senders} remainingIds={remainingIds} highlightedTruth={highlightedTruth} />
      </div>
    </div>
  );
}
