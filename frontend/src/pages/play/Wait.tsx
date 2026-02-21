// frontend/src/pages/play/Wait.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import {
  clearClaim,
  getClaim,
  getCurrentRoomCode,
  getOrCreateDeviceId,
  setLastError,
  wipePlayStateExceptDevice,
} from "../../lib/playStorage";
import styles from "./Wait.module.css";

function backToPlay(nav: (to: string, opts?: any) => void, message: string) {
  setLastError(message);
  wipePlayStateExceptDevice();
  nav("/play", { replace: true });
}

export default function PlayWait() {
  const nav = useNavigate();

  const roomCode = useMemo(() => getCurrentRoomCode(), []);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const claim = useMemo(() => getClaim(), []);

  const playerId = claim.player_id;
  const token = claim.player_session_token;

  const clientRef = useRef<LobbyClient | null>(null);
  const pingTimerRef = useRef<number | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [err, setErr] = useState<string>("");
  const [nameDraft, setNameDraft] = useState<string>("");

  useEffect(() => {
    if (!roomCode) {
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

      const me = s.players.find((p) => p.id === playerId);
      if (!me) {
        backToPlay(nav, "Ton player n’existe plus.");
        return;
      }
      if (me.status === "free") {
        backToPlay(nav, "Ton player a été libéré.");
        return;
      }
      if (me.status === "disabled") {
        backToPlay(nav, "Ton player a été désactivé.");
        return;
      }

      if (!nameDraft) setNameDraft(me.name || "");
    };

    c.onError = (code, message) => {
      if (code === "TOKEN_INVALID") {
        clearClaim();
        nav("/play/choose", { replace: true });
        return;
      }
      if (code === "LOBBY_NOT_FOUND") {
        backToPlay(nav, "Room introuvable");
        return;
      }
      setErr(message || "Erreur");
    };

    c.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        const reason = String(payload?.reason || "");
        const room = String(payload?.room_code || "");
        if (reason === "start_game" && room) {
          nav(`/play/game/${encodeURIComponent(room)}`, { replace: true });
          return;
        }
        backToPlay(nav, "Partie démarrée / room fermée");
        return;
      }

      if (type === "player_kicked") {
        const reason = String(payload?.reason || "");
        let msg = "Tu as été déconnecté";
        if (reason === "disabled") msg = "Ton player a été désactivé";
        else if (reason === "deleted") msg = "Ton player a été supprimé";
        else if (reason === "reset") msg = "Room réinitialisée";
        backToPlay(nav, msg);
      }
    };

    (async () => {
      try {
        await c.connectPlay(roomCode);
        await c.playHello(deviceId);
        // Start ping loop (5s)
        pingTimerRef.current = window.setInterval(async () => {
          try {
            await c.ping(roomCode, deviceId, playerId, token);
          } catch {}
        }, 5000);
      } catch {
        backToPlay(nav, "Connexion lobby impossible");
      }
    })();

    return () => {
      if (pingTimerRef.current) window.clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
      try {
        c.ws.disconnect();
      } catch {}
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, deviceId, playerId, token]);

  const me = useMemo(() => {
    if (!st) return null;
    return st.players.find((p) => p.id === playerId) || null;
  }, [st, playerId]);

  async function changePlayer() {
    const c = clientRef.current;
    if (!c) return;

    try {
      await c.releasePlayer(roomCode, deviceId, playerId, token);
    } catch {
      // ignore
    }
    clearClaim();
    nav("/play/choose", { replace: true });
  }

  async function submitName() {
    const c = clientRef.current;
    if (!c) return;

    const next = String(nameDraft || "").slice(0, 30);
    setNameDraft(next);

    try {
      await c.setPlayerName(roomCode, deviceId, playerId, token, next);
      setErr("");
    } catch {
      setErr("Impossible de renommer");
    }
  }

  function goCapturePhoto() {
    // keep current photo flow as-is
    nav("/play/photo");
  }

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <button className={styles.backBtn} onClick={changePlayer}>
          Changer de player
        </button>
        <div className={styles.code}>Code: {roomCode}</div>
      </div>

      <div className={styles.card}>
        <h1 className={styles.title}>Connecté</h1>
        <div className={styles.subtitle}>Le jeu va bientôt commencer.</div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <div className={styles.meRow}>
          <div className={styles.avatar}>{me?.photo_url ? <img src={me.photo_url} alt="" /> : null}</div>
          <div className={styles.meInfo}>
            <div className={styles.meName}>{me?.name || "—"}</div>
            <div className={styles.meStatus}>Connecté</div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Modifier mon nom</div>
          <input
            className={styles.input}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={30}
            placeholder="Ton nom"
          />
          <button className={styles.primary} onClick={submitName}>
            Enregistrer
          </button>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Photo</div>
          <button className={styles.secondary} onClick={goCapturePhoto}>
            Ajouter ma photo
          </button>
        </div>
      </div>
    </div>
  );
}
