import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDraftStore, buildLobbyDraftPayload } from "../../store/draftStore";
import { useLobbyStore } from "../../store/lobbyStore";
import { LobbyClient } from "../../ws/lobbyClient";
import { toast } from "../../components/common/Toast";
import styles from "./Lobby.module.css";
import JoinCodePanel from "../../components/master/lobby/JoinCodePanel";
import PlayersGrid from "../../components/master/lobby/PlayersGrid";
import StartGameBar from "../../components/master/lobby/StartGameBar";

export default function MasterLobby() {
  const nav = useNavigate();

  const join_code = useDraftStore(s => s.join_code);
  const master_key = useDraftStore(s => s.master_key);
  const local_room_id = useDraftStore(s => s.local_room_id);

  const senders = useDraftStore(s => s.senders);
  const reelItemsByUrl = useDraftStore(s => s.reelItemsByUrl);

  const setPlayers = useLobbyStore(s => s.setPlayers);
  const ready = useLobbyStore(s => s.readyToStart);
  const players = useLobbyStore(s => s.players);

  const clientRef = useRef<LobbyClient | null>(null);
  const [connected, setConnected] = useState(false);

  const draftFingerprint = useMemo(() => {
    // resync on any impactful draft change
    const a = senders
      .filter(s => !s.hidden)
      .map(s => `${s.sender_id_local}:${s.display_name}:${s.active}:${s.reel_count_total}:${s.badge}`)
      .sort()
      .join("|");

    const b = Object.keys(reelItemsByUrl).length;

    return `${a}::${b}`;
  }, [senders, reelItemsByUrl]);

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

        // ✅ Push draft incl. reel_items
        client.syncFromDraft(master_key, buildLobbyDraftPayload());
      } catch {
        toast("WS lobby indisponible");
      }
    })();

    return () => client.ws.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join_code, master_key, local_room_id]);

  useEffect(() => {
    if (!connected) return;
    if (!master_key) return;
    const client = clientRef.current;
    if (!client) return;

    // ✅ Resync draft live incl. reel_items
    client.syncFromDraft(master_key, buildLobbyDraftPayload());
  }, [draftFingerprint, connected, master_key]);

  const activeCount = useMemo(
    () => players.filter(p => p.active && p.status !== "disabled").length,
    [players]
  );

  if (!join_code || !master_key) return null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <JoinCodePanel joinCode={join_code} />
        <div className={styles.meta}>
          <div className={styles.line}>
            <span className={styles.k}>Connectés / actifs</span>{" "}
            <span className={styles.v}>{connected ? "" : "(WS…)"} {activeCount}</span>
          </div>
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
