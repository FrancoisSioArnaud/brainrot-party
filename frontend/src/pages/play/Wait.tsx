import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import styles from "./Wait.module.css";

function getDeviceId(): string {
  const v = localStorage.getItem("brp_device_id");
  if (v) return v;
  const id = crypto.randomUUID();
  localStorage.setItem("brp_device_id", id);
  return id;
}

function readJoinCode(): string | null {
  return localStorage.getItem("brp_join_code");
}
function readPlayerId(): string | null {
  return localStorage.getItem("brp_player_id");
}
function readToken(): string | null {
  return localStorage.getItem("brp_player_session_token");
}

export default function PlayWait() {
  const nav = useNavigate();

  const joinCode = useMemo(() => readJoinCode(), []);
  const deviceId = useMemo(() => getDeviceId(), []);
  const playerId = useMemo(() => readPlayerId(), []);
  const token = useMemo(() => readToken(), []);

  const clientRef = useRef<LobbyClient | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [err, setErr] = useState<string>("");
  const [nameDraft, setNameDraft] = useState<string>("");

  const me = useMemo(() => {
    if (!st || !playerId) return null;
    return st.players.find((p) => p.id === playerId) || null;
  }, [st, playerId]);

  useEffect(() => {
    if (!joinCode) {
      nav("/play", { replace: true });
      return;
    }
    if (!playerId || !token) {
      nav("/play/choose", { replace: true });
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
        // If lobby closed because start_game, the play app should navigate to /play/game/:roomCode.
        // MVP: we only show message; routing depends on your app.
        const reason = String(payload?.reason || "");
        setErr(reason === "start_game" ? "Partie démarrée" : "Lobby fermé");
      }
      if (type === "player_kicked") {
        const reason = String(payload?.reason || "");
        if (reason === "disabled") setErr("Ton player a été désactivé");
        else if (reason === "deleted") setErr("Ton player a été supprimé");
        else setErr("Tu as été déconnecté");

        localStorage.removeItem("brp_player_id");
        localStorage.removeItem("brp_player_session_token");
        nav("/play/choose", { replace: true });
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
  }, [joinCode, deviceId, playerId, token, nav]);

  // init draft name from server once
  useEffect(() => {
    if (!me) return;
    setNameDraft(me.name || "");
  }, [me?.id]); // only when me appears first time / changes

  // ping every 5s
  useEffect(() => {
    if (!joinCode || !playerId || !token) return;
    const c = clientRef.current;
    if (!c) return;

    const t = setInterval(() => {
      c.ping(deviceId, playerId, token).catch(() => {});
    }, 5000);

    // immediate ping
    c.ping(deviceId, playerId, token).catch(() => {});

    return () => clearInterval(t);
  }, [joinCode, deviceId, playerId, token]);

  async function saveName() {
    if (!playerId || !token) return;
    const c = clientRef.current;
    if (!c) return;
    try {
      await c.setPlayerName(deviceId, playerId, token, nameDraft.trim().slice(0, 32));
      setErr("");
    } catch {
      setErr("Impossible de renommer");
    }
  }

  async function resetName() {
    if (!playerId || !token) return;
    const c = clientRef.current;
    if (!c) return;
    try {
      await c.resetPlayerName(deviceId, playerId, token);
      setErr("");
    } catch {
      setErr("Impossible de reset");
    }
  }

  async function changePlayer() {
    if (!playerId || !token) return;
    const c = clientRef.current;
    if (!c) return;
    try {
      await c.releasePlayer(deviceId, playerId, token);
    } catch {
      // even if server fails, clear locally to avoid being stuck
      localStorage.removeItem("brp_player_id");
      localStorage.removeItem("brp_player_session_token");
    }
    nav("/play/choose", { replace: true });
  }

  if (!joinCode) return null;

  if (!playerId || !token) {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.title}>Non connecté</div>
          <button className={styles.btn} onClick={() => nav("/play/choose")}>Choisir un player</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.title}>Connecté. Le jeu va bientôt commencer.</div>
        <div className={styles.sub}>
          Code: <span className={styles.code}>{joinCode}</span>
        </div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <div className={styles.meRow}>
          <div className={styles.avatar}>
            {me?.photo_url ? <img src={me.photo_url} alt="" /> : null}
          </div>

          <div className={styles.meInfo}>
            <div className={styles.meName}>{me?.name || "—"}</div>
            <div className={styles.meStatus}>
              {me?.status === "connected" ? "Connecté" :
               me?.status === "afk" ? `AFK (${me.afk_seconds_left ?? "?"}s)` :
               me?.status === "free" ? "Libre" :
               "Désactivé"}
            </div>
          </div>
        </div>

        <div className={styles.form}>
          <div className={styles.label}>Modifier mon nom</div>
          <input
            className={styles.input}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Ton nom"
            maxLength={32}
          />

          <div className={styles.row}>
            <button className={styles.btn} onClick={saveName}>Enregistrer</button>
            <button className={styles.btn} onClick={resetName}>Reset nom</button>
          </div>
        </div>

        {/* Photo capture (camera only) is out of scope here: requires media/crop/upload endpoint. Placeholder UI. */}
        <div className={styles.photoBox}>
          <div className={styles.label}>Photo</div>
          <div className={styles.photoHint}>Camera only (à brancher sur l’endpoint upload photo).</div>
        </div>

        <div className={styles.row}>
          <button className={styles.btnDanger} onClick={changePlayer}>Changer de player</button>
        </div>
      </div>
    </div>
  );
}
