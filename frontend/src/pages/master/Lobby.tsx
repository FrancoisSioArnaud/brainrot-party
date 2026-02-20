import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDraftStore } from "../../store/draftStore";
import { useLobbyStore } from "../../store/lobbyStore";
import { LobbyClient } from "../../ws/lobbyClient";
import { toast } from "../../components/common/Toast";
import styles from "./Lobby.module.css";
import JoinCodePanel from "../../components/master/lobby/JoinCodePanel";
import PlayersGrid from "../../components/master/lobby/PlayersGrid";
import StartGameBar from "../../components/master/lobby/StartGameBar";

export default function MasterLobby() {
  const nav = useNavigate();
  const draft = useDraftStore(s => s);
  const join_code = draft.join_code;
  const master_key = draft.master_key;
  const local_room_id = draft.local_room_id;

  const setPlayers = useLobbyStore(s => s.setPlayers);
  const ready = useLobbyStore(s => s.readyToStart);
  const players = useLobbyStore(s => s.players);

  const clientRef = useRef<LobbyClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!join_code || !master_key || !local_room_id) {
      nav("/master/setup", { replace: true });
      return;
    }
    const client = new LobbyClient();
    clientRef.current = client;
    client.bind();
    client.onState = (st) => {
      setPlayers(st.players as any);
      setConnected(true);
    };

    (async () => {
      try {
        await client.connectMaster(join_code);
        client.masterHello(master_key, local_room_id);
        // push draft immediately
        client.syncFromDraft(master_key, {
          local_room_id,
          senders_active: draft.senders.filter(s => !s.hidden && s.active && s.reel_count_total > 0).map(s => ({ id_local: s.sender_id_local, name: s.display_name, active: true })),
          players: [] // server will create auto players if it wants; keeping minimal here
        });
      } catch {
        toast("WS lobby indisponible");
      }
    })();

    return () => client.ws.disconnect();
  }, [join_code, master_key, local_room_id]);

  const activeCount = useMemo(() => players.filter(p => p.active && p.status !== "disabled").length, [players]);

  if (!join_code || !master_key) return null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <JoinCodePanel joinCode={join_code} />
        <div className={styles.meta}>
          <div className={styles.line}><span className={styles.k}>Connectés / actifs</span> <span className={styles.v}>{connected ? "" : "(WS…)"} {activeCount}</span></div>
        </div>
      </div>

      <PlayersGrid
        players={players}
        onCreate={async () => {
          const name = prompt("Nom du player ?") || "Player";
          clientRef.current?.createManualPlayer(master_key, name);
        }}
        onDelete={(id) => clientRef.current?.deletePlayer(master_key, id)}
        onToggleActive={(id, active) => clientRef.current?.setPlayerActive(master_key, id, active)}
      />

      <StartGameBar
        ready={ready}
        onBackSetup={() => nav("/master/setup")}
        onStart={async () => {
          clientRef.current?.startGame(master_key, local_room_id!);
        }}
      />
    </div>
  );
}
