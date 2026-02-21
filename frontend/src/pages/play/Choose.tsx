import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import {
  getCurrentRoomCode,
  getOrCreateDeviceId,
  setLastError,
  wipePlayStateExceptDevice,
} from "../../lib/playStorage";
import styles from "./Choose.module.css";

export default function PlayChoose() {
  const nav = useNavigate();

  const roomCode = useMemo(() => getCurrentRoomCode(), []);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);

  const clientRef = useRef<LobbyClient | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (!roomCode) {
      nav("/play", { replace: true });
      return;
    }

    const c = new LobbyClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setErr("");
    };

    c.onError = (code, message) => {
      if (code === "LOBBY_NOT_FOUND") {
        const msg = "Room introuvable";
        setLastError(msg);
        wipePlayStateExceptDevice();
        nav("/play", { replace: true });
        return;
      }
      setErr(message || "Erreur");
    };

    c.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        const msg = "Partie démarrée / room fermée";
        setLastError(msg);
        wipePlayStateExceptDevice();
        nav("/play", { replace: true });
        return;
      }

      if (type === "player_kicked") {
        const reason = String(payload?.reason || "");
        let msg = "Tu as été déconnecté";
        if (reason === "disabled") msg = "Ton player a été désactivé";
        else if (reason === "deleted") msg = "Ton player a été supprimé";
        else if (reason === "reset") msg = "Room réinitialisée";

        setLastError(msg);
        wipePlayStateExceptDevice();
        nav("/play", { replace: true });
        return;
      }
    };

    (async () => {
      try {
        await c.connectPlay(roomCode);
        await c.playHello(deviceId);
      } catch {
        const msg = "Connexion lobby impossible";
        setLastError(msg);
        nav("/play", { replace: true });
      }
    })();

    return () => c.ws.disconnect();
  }, [roomCode, deviceId, nav]);

  const visiblePlayers = useMemo(() => {
    if (!st) return [];
    return st.players.filter((p) => p.active && p.status !== "disabled");
  }, [st]);

  async function claim(pId: string) {
    try {
      if (!roomCode) return;

      const c = clientRef.current;
      if (!c) return;

      await c.claimPlayer(roomCode, deviceId, pId);
      nav("/play/wait", { replace: true });
    } catch (e: any) {
      const code = String(e?.code || "");
      if (code === "TAKEN") setErr("Pris à l’instant");
      else setErr("Impossible de choisir ce player");
    }
  }

  if (!roomCode) return null;

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.title}>Choisis ton player</div>
        <div className={styles.sub}>
          Code: <span className={styles.code}>{roomCode}</span>
        </div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <div className={styles.grid}>
          {visiblePlayers.map((p) => {
            const disabled = p.status !== "free";
            const label = disabled ? "Déjà pris" : "Libre";

            return (
              <button
                key={p.id}
                className={`${styles.player} ${disabled ? styles.playerDisabled : ""}`}
                disabled={disabled}
                onClick={() => claim(p.id)}
              >
                <div className={styles.avatar}>
                  {p.photo_url ? <img src={p.photo_url} alt="" /> : null}
                </div>
                <div className={styles.info}>
                  <div className={styles.name}>{p.name}</div>
                  <div className={styles.status}>{label}</div>
                </div>
              </button>
            );
          })}
        </div>

        <button className={styles.back} onClick={() => nav("/play", { replace: true })}>
          Retour
        </button>
      </div>
    </div>
  );
}
