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

  // Reveal sequence UI (driven by WS events)
  const [revealStep, setRevealStep] = useState<number>(0);
  const [votesByPlayer, setVotesByPlayer] = useState<Record<string, string[]>>({});
  const [truthSenderIds, setTruthSenderIds] = useState<string[]>([]);
  const [correctnessByPlayerSender, setCorrectnessByPlayerSender] = useState<
    Record<string, Record<string, boolean>>
  >({});

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

    c.onEvent = (type, payload) => {
      if (type === "game_end") {
        toast("Fin de partie");
        return;
      }

      if (type === "voting_started") {
        setRevealStep(0);
        setVotesByPlayer({});
        setTruthSenderIds([]);
        setCorrectnessByPlayerSender({});
        return;
      }

      if (type === "reveal_step") {
        const step = Number(payload?.step || 0);
        setRevealStep(step);

        if (step === 1 && payload?.votes_by_player) {
          setVotesByPlayer(payload.votes_by_player);
        }
        if ((step === 2 || step === 5) && Array.isArray(payload?.truth_sender_ids)) {
          setTruthSenderIds(payload.truth_sender_ids);
        }
        if (step === 3 && payload?.correctness_by_player_sender) {
          setCorrectnessByPlayerSender(payload.correctness_by_player_sender);
        }
        return;
      }

      if (type === "lobby_closed") {
        toast("Lobby fermé");
        nav("/master/setup", { replace: true });
        return;
      }
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
  }, [roomCode, nav]);

  const k = st?.focus_item?.k || 0;

  const showPlacards = useMemo(() => {
    return revealStep >= 1;
  }, [revealStep]);

  const remainingIds = useMemo(() => {
    return st?.remaining_senders || [];
  }, [st]);

  const highlightedTruth = useMemo(() => {
    return new Set(revealStep >= 2 ? truthSenderIds : []);
  }, [revealStep, truthSenderIds]);

  const focusTruthSenderIds = useMemo(() => {
    return revealStep >= 5 ? truthSenderIds : [];
  }, [revealStep, truthSenderIds]);

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
              try {
                await clientRef.current?.openReel();
              } catch {
                toast("Impossible d’ouvrir");
              }
            }}
            onStartVoting={async () => {
              try {
                await clientRef.current?.startVoting();
              } catch {
                toast("Impossible de lancer le vote");
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
            correctnessByPlayerSender={correctnessByPlayerSender}
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
