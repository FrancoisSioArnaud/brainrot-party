import React, { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useDraftStore } from "../../store/draftStore";
import { useGameStore } from "../../store/gameStore";
import { GameClient } from "../../ws/gameClient";
import { toast } from "../../components/common/Toast";
import styles from "./Game.module.css";

import ReelsPanel from "../../components/master/game/ReelsPanel";
import RemainingSendersBar from "../../components/master/game/RemainingSendersBar";
import PlayersBar from "../../components/master/game/PlayersBar";
import Leaderboard from "../../components/master/game/Leaderboard";
import TimerButton from "../../components/master/game/TimerButton";

export default function MasterGame() {
  const { roomCode } = useParams();
  const master_key = useDraftStore(s => s.master_key);
  const applyStateSync = useGameStore(s => s.applyStateSync);
  const applyRevealStep = useGameStore(s => s.applyRevealStep);

  const clientRef = useRef<GameClient | null>(null);

  useEffect(() => {
    if (!roomCode || !master_key) return;
    const client = new GameClient();
    clientRef.current = client;

    client.ws.onMessage((msg) => {
      if (msg.type === "state_sync") applyStateSync(msg.payload);
      if (msg.type === "reveal_step") applyRevealStep(msg.payload);
      if (msg.type === "focus_changed") {
        // handled by next state_sync in backend; optional local patch
      }
    });

    (async () => {
      try {
        await client.connectMaster(roomCode);
        client.masterHello(roomCode, master_key);
      } catch {
        toast("WS game indisponible");
      }
    })();

    return () => client.ws.disconnect();
  }, [roomCode, master_key]);

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <ReelsPanel onOpen={(item_id, url) => {
          if (url) window.open(url, "_blank", "noopener,noreferrer");
          clientRef.current?.masterOpenReel(master_key!, item_id);
        }} />
        <div className={styles.side}>
          <Leaderboard />
          <TimerButton onStart={(item_id) => clientRef.current?.masterStartTimer(master_key!, item_id, 10)} />
        </div>
      </div>

      <RemainingSendersBar />
      <PlayersBar />
    </div>
  );
}
