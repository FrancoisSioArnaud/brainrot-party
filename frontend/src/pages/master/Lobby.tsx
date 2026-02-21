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

  const join_code = useDraftStore(s => s.join_code);
  const master_key = useDraftStore(s => s.master_key);
  const local_room_id = useDraftStore(s => s.local_room_id);
  const draftSenders = useDraftStore(s => s.senders);

  const setPlayers = useLobbyStore(s => s.setPlayers);
  const ready = useLobbyStore(s => s.readyToStart);
  const players = useLobbyStore(s => s.players);

  const clientRef = useRef<LobbyClient | null>(null);
  const [connected, setConnected] = useState(false);

  // Draft -> payload (senders actifs only)
  const senders_active = useMemo(() => {
    return draftSenders
      .filter(s => !s.hidden && s.active && s.reel_count_total > 0)
      .map(s => ({ id_local: s.sender_id_local, name: s.display_name, active: true }));
  }, [draftSenders]);

  // Draft -> players auto (1 par sender actif)
  const players_auto = useMemo(() => {
    return senders_active.map(s => ({
      id: `auto_${s.id_local}`,
      type: "sender_linked" as const,
      sender_id: s.id_local,
      active: true,
      name: s.name
    }));
  }, [senders_active]);

  const draftFingerprint = useMemo(() => {
    const key = senders_active
      .slice()
      .sort((a, b) => a.id_local.localeCompare(b.id_local))
      .map(s => `${s.id_local}:${s.name}`)
      .join("|");
    return key;
  }, [senders_active]);

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

    client.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        const reason = String(payload?.reason || "");
        if (reason === "start_game") {
          const roomCode = String(payload?.room_code || join_code);
          nav(`/master/game/${encodeURIComponent(roomCode)}`, { replace: true });
          return;
        }
        toast("Lobby fermé");
        nav("/master/setup", { replace: true });
      }
    };

    (async () => {
      try {
        await client.connectMaster(join_code);
        client.masterHello(master_key, local_room_id);

        client.syncFromDraft(master_key, {
          local_room_id,
          senders_active,
          players: players_auto
        });
      } catch {
        toast("WS lobby indisponible");
      }
    })();

    return () => client.ws.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join_code, master_key, local_room_id]);

  useEffect(() => {
    if (!connected) return;
    if (!join_code || !master_key || !local_room_id) return;
    const client = clientRef.current;
    if (!client) return;

    client.syncFromDraft(master_key, {
      local_room_id,
      senders_active,
      players: players_auto
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFingerprint, connected]);

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
          await clientRef.current?.createManualPlayer(master_key, name);
        }}
        onDelete={async (id) => {
          await clientRef.current?.deletePlayer(master_key, id);
        }}
        onToggleActive={async (id, active) => {
          await clientRef.current?.setPlayerActive(master_key, id, active);
        }}
      />

      <StartGameBar
        ready={ready}
        onBackSetup={() => nav("/master/setup")}
        onStart={async () => {
          if (!window.confirm("Démarrer la partie ?")) return;
          try {
            await clientRef.current?.startGame(master_key);
            // navigation happens via lobby_closed (source of truth)
          } catch {
            toast("Start game refusé (players pas prêts)");
          }
        }}
      />
    </div>
  );
}
