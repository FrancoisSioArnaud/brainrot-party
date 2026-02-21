import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import styles from "./Choose.module.css";

function getOrCreateDeviceId(): string {
  const k = "brp_device_id";
  const cur = localStorage.getItem(k);
  if (cur) return cur;
  const id = crypto.randomUUID();
  localStorage.setItem(k, id);
  return id;
}

function readJoinCode(): string | null {
  // set by /play code screen, or fallback
  return localStorage.getItem("brp_join_code");
}

export default function PlayChoose() {
  const nav = useNavigate();

  const joinCode = useMemo(() => readJoinCode(), []);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);

  const clientRef = useRef<LobbyClient | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (!joinCode) {
      nav("/play", { replace: true });
      return;
    }

    const c = new LobbyClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setErr("");
    };

    c.onError = (_code, message) => setErr(message || "Erreur");

    c.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        setErr("Partie démarrée / room fermée");
      }
      if (type === "player_kicked") {
        const reason = String(payload?.reason || "");
        if (reason === "disabled") setErr("Ton player a été désactivé");
        else if (reason === "deleted") setErr("Ton player a été supprimé");
        else setErr("Tu as été déconnecté");
        // clear local claim
        localStorage.removeItem("brp_player_id");
        localStorage.removeItem("brp_player_session_token");
      }
    };

    (async () => {
      try {
        await c.connectPlay(joinCode);
        await c.playHello(deviceId);
      } catch {
        setErr("Connexion lobby impossible");
      }
    })();

    return () => c.ws.disconnect();
  }, [joinCode, deviceId, nav]);

  const visiblePlayers = useMemo(() => {
    if (!st) return [];
    return st.players.filter((p) => p.active && p.status !== "disabled");
  }, [st]);

  async function claim(pId: string) {
    if (!joinCode) return;
    try {
      const c = clientRef.current;
      if (!c) return;
      await c.claimPlayer(joinCode, deviceId, pId);
      nav("/play/wait");
    } catch (e: any) {
      setErr("Pris à l’instant");
    }
  }

  if (!joinCode) return null;

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.title}>Choisis ton player</div>
        <div className={styles.sub}>Code: <span className={styles.code}>{joinCode}</span></div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <div className={styles.grid}>
          {visiblePlayers.map((p) => {
            const disabled = p.status !== "free";
            const label =
              p.status === "connected" ? "Déjà pris" :
              p.status === "afk" ? "Réservé" :
              "Libre";

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
                  <div className={styles.status}>{label}{p.status === "afk" && p.afk_seconds_left != null ? ` (${p.afk_seconds_left}s)` : ""}</div>
                </div>
              </button>
            );
          })}
        </div>

        <button className={styles.back} onClick={() => nav("/play")}>
          Retour
        </button>
      </div>
    </div>
  );
}
