import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import styles from "./Choose.module.css";
import { setOneShotError } from "../../utils/playSession";

function getOrCreateDeviceId(): string {
  const k = "brp_device_id";
  const cur = localStorage.getItem(k);
  if (cur) return cur;
  const id = crypto.randomUUID();
  localStorage.setItem(k, id);
  return id;
}

const JOIN_CODE_KEY = "brp_join_code";
const JOIN_CODE_AT_KEY = "brp_join_code_saved_at";
const JOIN_CODE_TTL_MS = 8 * 60 * 60 * 1000; // 8h

function getFreshJoinCode(): string | null {
  const code = localStorage.getItem(JOIN_CODE_KEY);
  const atRaw = localStorage.getItem(JOIN_CODE_AT_KEY);

  if (!code) return null;

  // rétro-compat : si pas de timestamp, on le crée (évite de casser les anciens flows)
  if (!atRaw) {
    localStorage.setItem(JOIN_CODE_AT_KEY, String(Date.now()));
    return code;
  }

  const at = Number(atRaw);
  if (!Number.isFinite(at) || Date.now() - at > JOIN_CODE_TTL_MS) {
    localStorage.removeItem(JOIN_CODE_KEY);
    localStorage.removeItem(JOIN_CODE_AT_KEY);
    return null;
  }

  return code;
}

function stampJoinCode() {
  // on refresh le TTL à chaque arrivée sur /choose
  localStorage.setItem(JOIN_CODE_AT_KEY, String(Date.now()));
}

export default function PlayChoose() {
  const nav = useNavigate();

  const joinCode = useMemo(() => getFreshJoinCode(), []);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);

  const clientRef = useRef<LobbyClient | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (!joinCode) {
      setOneShotError("Code expiré. Rejoins à nouveau la room.");
      nav("/play", { replace: true });
      return;
    }

    stampJoinCode();

    const c = new LobbyClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setErr("");
    };

    c.onError = (code, message) => {
      // erreurs “room introuvable / fermée / ws” doivent s’afficher sur /play
      const m =
        code === "LOBBY_NOT_FOUND"
          ? "Room introuvable"
          : code === "LOBBY_CLOSED"
          ? "Partie démarrée / room fermée"
          : message || "Erreur";

      setOneShotError(m);
      nav("/play", { replace: true });
    };

    c.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        const reason = String(payload?.reason || "");
        if (reason === "start_game") {
          nav(`/play/game/${joinCode}`, { replace: true });
        } else {
          setOneShotError("Lobby fermé");
          nav("/play", { replace: true });
        }
      }

      if (type === "player_kicked") {
        const reason = String(payload?.reason || "");
        const msg =
          reason === "disabled"
            ? "Ton player a été désactivé"
            : reason === "deleted"
            ? "Ton player a été supprimé"
            : "Tu as été déconnecté";

        localStorage.removeItem("brp_player_id");
        localStorage.removeItem("brp_player_session_token");

        setOneShotError(msg);
        nav("/play", { replace: true });
      }
    };

    (async () => {
      try {
        await c.connectPlay(joinCode);
        c.bind();
        await c.playHello(deviceId);

        // Reconnexion: si déjà un claim local, tenter ping => /play/wait
        const pid = localStorage.getItem("brp_player_id");
        const tok = localStorage.getItem("brp_player_session_token");
        if (pid && tok) {
          try {
            await c.ping(deviceId, pid, tok);
            nav("/play/wait", { replace: true });
          } catch {
            // token invalide => on force un nouveau choix
            localStorage.removeItem("brp_player_id");
            localStorage.removeItem("brp_player_session_token");
          }
        }
      } catch {
        setOneShotError("Connexion lobby impossible");
        nav("/play", { replace: true });
      }
    })();

    return () => {
      try {
        c.ws.disconnect();
      } catch {}
    };
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

      // claim atomique serveur
      await c.claimPlayer(joinCode, deviceId, pId);

      // TTL 8h
      localStorage.setItem(JOIN_CODE_AT_KEY, String(Date.now()));

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
                className={`${styles.player} ${
                  disabled ? styles.playerDisabled : ""
                }`}
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
                    {p.status === "afk" && p.afk_seconds_left != null
                      ? ` (${p.afk_seconds_left}s)`
                      : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          className={styles.back}
          onClick={() => {
            setOneShotError("");
            nav("/play");
          }}
        >
          Retour
        </button>
      </div>
    </div>
  );
}
