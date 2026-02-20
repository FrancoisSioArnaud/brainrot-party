import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { GameClient } from "../../ws/gameClient";
import { useGameStore } from "../../store/gameStore";
import { getOrCreateDeviceId } from "../../utils/ids";
import VotePage from "./Vote";
import styles from "./Game.module.css";

export default function PlayGame() {
  const { roomCode } = useParams();
  const device_id = getOrCreateDeviceId();

  const applyStateSync = useGameStore(s => s.applyStateSync);
  const applyRevealStep = useGameStore(s => s.applyRevealStep);
  const room = useGameStore(s => s.room);

  const clientRef = useRef<GameClient | null>(null);
  const [auth, setAuth] = useState<{ player_id: string; token: string } | null>(null);

  useEffect(() => {
    // In real: load from localStorage after claim
    const pid = localStorage.getItem("brp_player_id");
    const tok = localStorage.getItem("brp_player_token");
    if (pid && tok) setAuth({ player_id: pid, token: tok });
  }, []);

  useEffect(() => {
    if (!roomCode || !auth) return;
    const client = new GameClient();
    clientRef.current = client;

    client.ws.onMessage((msg) => {
      if (msg.type === "state_sync") applyStateSync(msg.payload);
      if (msg.type === "reveal_step") applyRevealStep(msg.payload);
      if (msg.type === "voting_started") {
        // state_sync should follow; keeping simple
      }
    });

    (async () => {
      await client.connectPlay(roomCode);
      client.playHello(roomCode, device_id, auth.player_id, auth.token);
    })();

    return () => client.ws.disconnect();
  }, [roomCode, auth]);

  const phase = room?.phase || "WAIT";
  const isVoting = phase === "VOTING" || phase === "TIMER_RUNNING";

  return (
    <div className={styles.root}>
      {isVoting ? <VotePage client={clientRef.current} auth={auth} /> : <div className={styles.wait}>En attente du prochain vote…</div>}
    </div>
  );
}
