import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import styles from "./Choose.module.css";

function normalizeCode(input: string) {
  return (input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function readJoinCode(): string | null {
  return normalizeCode(localStorage.getItem("brp_join_code") || "");
}

function purgePlayClaim() {
  localStorage.removeItem("brp_player_id");
  localStorage.removeItem("brp_player_session_token");
}

function ensureDeviceIdForJoinCode(joinCode: string): string {
  // ✅ device_id NOT global: regenerate if lobby changes
  const scopeKey = "brp_device_id_scope";
  const deviceKey = "brp_device_id";

  const scopedTo = localStorage.getItem(scopeKey);
  const cur = localStorage.getItem(deviceKey);

  if (!cur || !scopedTo || scopedTo !== joinCode) {
    const id = crypto.randomUUID();
    localStorage.setItem(deviceKey, id);
    localStorage.setItem(scopeKey, joinCode);
    return id;
  }
  return cur;
}

export default function PlayChoose() {
  const nav = useNavigate();

  const joinCode = useMemo(() => readJoinCode(), []);
  const deviceId = useMemo(() => (joinCode ? ensureDeviceIdForJoinCode(joinCode) : ""), [joinCode]);

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

    c.onError = (code, message) => {
      const m = message || "Erreur";
      setErr(m);

      // ✅ If lobby not found / closed: reset and go back to /play with message
      if (code === "LOBBY_NOT_FOUND" || code === "ROOM_NOT_FOUND" || code === "LOBBY_CLOSED") {
        purgePlayClaim();
        localStorage.removeItem("brp_join_code");
        localStorage.removeItem("brp_device_id");
        localStorage.removeItem("brp_device_id_scope");

        // pass message to /play
        localStorage.setItem("brp_play_last_error", m);
        nav("/play", { replace: true });
      }
    };

    c.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        const msg = "Partie démarrée / room fermée";
        setErr(msg);
        localStorage.setItem("brp_play_last_error", msg);
        purgePlayClaim();
        // keep join_code; user can re-enter if needed
        nav("/play", { replace: true });
        return;
      }

      if (type === "player_kicked") {
        const reason = String(payload?.reason || "");
        let msg = "Tu as été déconnecté";
        if (reason === "disabled") msg = "Ton player a été désactivé";
        else if (reason === "deleted") msg = "Ton player a été supprimé";
        else if (reason === "reset") msg = "Room réinitialisée";

        setErr(msg);
        localStorage.setItem("brp_play_last_error", msg);
        purgePlayClaim();
        nav("/play", { replace: true });
        return;
      }
    };

    (async () => {
      try {
        await c.connectPlay(joinCode);
        await c.playHello(deviceId);
      } catch {
        const msg = "Connexion lobby impossible";
        setErr(msg);
        localStorage.setItem("brp_play_last_error", msg);
        nav("/play", { replace: true });
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
    } catch {
      setErr("Pris à l’instant");
    }
  }

  if (!joinCode) return null;

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.title}>Choisis ton player</div>
        <div className={styles.sub}>
          Code: <span className={styles.code}>{joinCode}</span>
        </div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <div className={styles.grid}>
          {visiblePlayers.map((p) => {
            const disabled = p.status !== "free";
            const label =
              p.status === "connected"
                ? "Déjà pris"
                : p.status === "afk"
                ? "Réservé"
                : "Libre";

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
                  <div className={styles.status}>
                    {label}
                    {p.status === "afk" && p.afk_seconds_left != null ? ` (${p.afk_seconds_left}s)` : ""}
                  </div>
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
