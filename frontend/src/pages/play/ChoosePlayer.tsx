import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LobbyClient, LobbyPlayer } from "../../ws/lobbyClient";
import { getOrCreateDeviceId } from "../../utils/ids";
import { toast } from "../../components/common/Toast";
import PlayersList from "../../components/play/lobby/PlayersList";
import styles from "./ChoosePlayer.module.css";

export default function PlayChoosePlayer() {
  const { joinCode } = useParams();
  const nav = useNavigate();
  const device_id = getOrCreateDeviceId();

  const clientRef = useRef<LobbyClient | null>(null);
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);

  useEffect(() => {
    if (!joinCode) return;
    const client = new LobbyClient();
    clientRef.current = client;
    client.bind();
    client.onState = (st) => setPlayers(st.players as any);

    client.ws.onMessage((msg) => {
      if (msg.type === "player_claimed") {
        // if server targets token per device, handle that; placeholder expects token broadcasted
      }
      if (msg.type === "player_kicked") {
        toast(msg.payload?.message || "Kicked");
      }
      if (msg.type === "lobby_closed" && msg.payload?.room_code) {
        nav(`/play/game/${msg.payload.room_code}`, { replace: true });
      }
    });

    (async () => {
      try {
        await client.connectPlay(joinCode);
        client.playHello(device_id);
      } catch {
        toast("Lobby indisponible");
      }
    })();

    return () => client.ws.disconnect();
  }, [joinCode]);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Choisir un player</h1>
      <PlayersList
        players={players.filter(p => p.active && p.status !== "disabled")}
        onPick={(p) => {
          // send claim; token must be received from server (targeted)
          clientRef.current?.claimPlayer(device_id, p.id);
          toast("Choix envoyé. Attends la confirmation.");
          // In real impl: navigate after receiving token; placeholder:
        }}
      />
      <div className={styles.note}>Si ton player est pris, choisis-en un autre.</div>
    </div>
  );
}
