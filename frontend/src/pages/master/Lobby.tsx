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
import Modal from "../../components/common/Modal";

export default function MasterLobby() {
  const nav = useNavigate();

  const join_code = useDraftStore((s) => s.join_code);
  const master_key = useDraftStore((s) => s.master_key);
  const local_room_id = useDraftStore((s) => s.local_room_id);
  const draftSenders = useDraftStore((s) => s.senders);

  const setPlayers = useLobbyStore((s) => s.setPlayers);
  const ready = useLobbyStore((s) => s.readyToStart);
  const players = useLobbyStore((s) => s.players);

  const clientRef = useRef<LobbyClient | null>(null);
  const [connected, setConnected] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const nextManualName = useMemo(() => {
    const manualCount = players.filter((p) => p.type === "manual").length;
    return `Player ${manualCount + 1}`;
  }, [players]);

  const senders_active = useMemo(() => {
    return draftSenders
      .filter((s) => !s.hidden && s.active && s.reel_count_total > 0)
      .map((s) => ({ id_local: s.sender_id_local, name: s.display_name, active: true }));
  }, [draftSenders]);

  const players_auto = useMemo(() => {
    return senders_active.map((s) => ({
      id: `auto_${s.id_local}`,
      type: "sender_linked" as const,
      sender_id: s.id_local,
      active: true,
      name: s.name,
    }));
  }, [senders_active]);

  const draftFingerprint = useMemo(() => {
    return senders_active
      .slice()
      .sort((a, b) => a.id_local.localeCompare(b.id_local))
      .map((s) => `${s.id_local}:${s.name}`)
      .join("|");
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

    client.onLobbyClosed = (reason) => {
      if (reason === "start_game") return;
      toast("Lobby fermé");
      nav("/master/setup", { replace: true });
    };

    client.onGameCreated = (room_code) => {
      nav(`/master/game/${encodeURIComponent(room_code)}`, { replace: true });
    };

    (async () => {
      try {
        await client.connectMaster(join_code);
        await client.masterHello(master_key, local_room_id);

        await client.syncFromDraft(master_key, {
          local_room_id,
          senders_active,
          players: players_auto,
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
      players: players_auto,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFingerprint, connected]);

  const activeCount = useMemo(
    () => players.filter((p) => p.active && p.status !== "disabled").length,
    [players]
  );

  const connectedOrAfkCount = useMemo(() => {
    return players.filter(
      (p) => p.active && p.status !== "disabled" && (p.status === "connected" || p.status === "afk")
    ).length;
  }, [players]);

  if (!join_code || !master_key) return null;

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <div className={styles.topLeft}>
          <h1 className={styles.title}>Connexion des joueurs</h1>
          <div className={styles.subtitle}>Tous les joueurs doivent être connectés pour démarrer.</div>
        </div>
        <div className={styles.topRight}>
          <div className={styles.statBox}>
            <div className={styles.statLine}>
              <span className={styles.k}>Players actifs</span>
              <span className={styles.v}>{activeCount}</span>
            </div>
            <div className={styles.statLine}>
              <span className={styles.k}>Connectés / AFK</span>
              <span className={styles.v}>
                {connected ? "" : "(WS…) "}
                {connectedOrAfkCount}/{activeCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      <JoinCodePanel joinCode={join_code} />

      <PlayersGrid
        players={players}
        onCreate={() => {
          setCreateName(nextManualName);
          setCreateOpen(true);
        }}
        onDelete={(id) => clientRef.current?.deletePlayer(master_key, id)}
        onToggleActive={(id, active) => clientRef.current?.setPlayerActive(master_key, id, active)}
      />

      <div className={styles.footer}>
        <StartGameBar
          ready={ready}
          onBackSetup={() => nav("/master/setup")}
          onStart={async () => {
            try {
              const r = await clientRef.current?.startGame(master_key, local_room_id!);
              if (r?.room_code) nav(`/master/game/${encodeURIComponent(r.room_code)}`, { replace: true });
            } catch {
              // toast already handled by WSClient
            }
          }}
        />
      </div>

      <Modal open={createOpen} title="Créer un player" onClose={() => setCreateOpen(false)}>
        <div className={styles.modalBody}>
          <label className={styles.modalLabel}>Nom</label>
          <input
            className={styles.modalInput}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Player 1"
            autoFocus
          />
          <div className={styles.modalActions}>
            <button className={styles.secondaryBtn} onClick={() => setCreateOpen(false)}>
              Annuler
            </button>
            <button
              className={styles.primaryBtn}
              onClick={async () => {
                const name = (createName || "").trim() || nextManualName;
                await clientRef.current?.createManualPlayer(master_key, name);
                setCreateOpen(false);
              }}
            >
              Créer
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
