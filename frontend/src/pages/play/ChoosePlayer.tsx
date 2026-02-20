import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styles from "./ChoosePlayer.module.css";
import { getOrCreateDeviceId } from "../../utils/ids";
import PlayersList from "../../components/play/lobby/PlayersList";
import { PlayLobbyClient, LobbyPlayerLite } from "../../ws/playLobbyClient";
import { setPlaySession, setOneShotError } from "../../utils/playSession";

export default function PlayChoosePlayer() {
  const { joinCode } = useParams();
  const nav = useNavigate();
  const device_id = getOrCreateDeviceId();

  const clientRef = useRef<PlayLobbyClient | null>(null);

  const [players, setPlayers] = useState<LobbyPlayerLite[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!joinCode) return;

    const c = new PlayLobbyClient();
    clientRef.current = c;

    c.onLobbyState = (payload) => {
      setPlayers((payload.players || []) as LobbyPlayerLite[]);
      setError("");
    };

    c.onClosed = () => {
      setOneShotError("Partie démarrée / room fermée");
      nav("/play", { replace: true });
    };

    c.onError = (p) => {
      const code = p?.code || "UNKNOWN";
      if (code === "LOBBY_NOT_FOUND") {
        setOneShotError("Room introuvable");
        nav("/play", { replace: true });
        return;
      }
      if (code === "TAKEN") setError("Pris à l’instant");
      else if (code === "DOUBLE_DEVICE") setError("Double device refusé : tu as déjà un player");
      else setError(p?.message || "Erreur");
    };

    // ACK claim_player contient { ok:true, player_id, player_session_token }
    c.onAck = (p) => {
      if (!p?.ok) return;
      if (p?.player_id && p?.player_session_token) {
        setPlaySession({
          join_code: String(joinCode),
          player_id: String(p.player_id),
          player_token: String(p.player_session_token),
        });
        nav(`/play/wait/${encodeURIComponent(String(joinCode))}`, { replace: true });
      }
    };

    (async () => {
      try {
        await c.connect(String(joinCode));
        c.hello(device_id);
      } catch {
        setOneShotError("Room introuvable");
        nav("/play", { replace: true });
      }
    })();

    return () => c.disconnect();
  }, [joinCode, device_id, nav]);

  const visible = useMemo(
    () => players.filter((p) => p.active && p.status !== "disabled"),
    [players]
  );

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Choisir un player</h1>

      {error ? (
        <div style={{ marginBottom: 10, padding: 12, borderRadius: 14, border: "1px solid var(--border)" }}>
          {error}
        </div>
      ) : null}

      <PlayersList
        players={visible}
        onPick={(p) => clientRef.current?.claimPlayer(device_id, p.id)}
      />

      <div className={styles.note}>Si ton player est pris, choisis-en un autre.</div>
    </div>
  );
}
