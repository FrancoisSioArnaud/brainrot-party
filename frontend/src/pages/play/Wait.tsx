// frontend/src/pages/play/Wait.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import styles from "./Wait.module.css";

function normalizeCode(input: string) {
  return (input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function getJoinCode(): string {
  return normalizeCode(localStorage.getItem("brp_join_code") || "");
}

function getDeviceIdForJoinCode(joinCode: string): string {
  const scopeKey = "brp_device_id_scope";
  const deviceKey = "brp_device_id";
  const scope = localStorage.getItem(scopeKey);
  const cur = localStorage.getItem(deviceKey);

  // device_id NOT global: if mismatch, force reset and re-choose
  if (!cur || !scope || scope !== joinCode) {
    return "";
  }
  return cur;
}

function getPlayerId(): string {
  return localStorage.getItem("brp_player_id") || "";
}
function getToken(): string {
  return localStorage.getItem("brp_player_session_token") || "";
}

function purgePlayClaim() {
  localStorage.removeItem("brp_player_id");
  localStorage.removeItem("brp_player_session_token");
}

function backToPlay(nav: (to: string, opts?: any) => void, message: string) {
  localStorage.setItem("brp_play_last_error", message);
  purgePlayClaim();
  nav("/play", { replace: true });
}

export default function PlayWait() {
  const nav = useNavigate();

  const joinCode = useMemo(() => getJoinCode(), []);
  const playerId = useMemo(() => getPlayerId(), []);
  const token = useMemo(() => getToken(), []);
  const deviceId = useMemo(() => (joinCode ? getDeviceIdForJoinCode(joinCode) : ""), [joinCode]);

  const clientRef = useRef<LobbyClient | null>(null);
  const pingTimerRef = useRef<number | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [err, setErr] = useState<string>("");

  const [nameDraft, setNameDraft] = useState<string>("");

  useEffect(() => {
    // Guards
    if (!joinCode) {
      nav("/play", { replace: true });
      return;
    }
    if (!deviceId) {
      // device scope mismatch => force rejoin
      backToPlay(nav, "Session invalide (changement de lobby).");
      return;
    }
    if (!playerId || !token) {
      nav(`/play/choose/${encodeURIComponent(joinCode)}`, { replace: true });
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
        // you got released (timeout)
        backToPlay(nav, "Ton player a été libéré (inactivité).");
        return;
      }
      if (me.status === "disabled") {
        backToPlay(nav, "Ton player a été désactivé.");
        return;
      }

      // init rename draft with current value (only if empty)
      if (!nameDraft) setNameDraft(me.name || "");
    };

    c.onError = (code, message) => {
      const m = message || "Erreur";
      setErr(`${code}: ${m}`);

      if (code === "TOKEN_INVALID") {
        backToPlay(nav, "Session invalide. Rejoins à nouveau.");
        return;
      }
      if (code === "LOBBY_NOT_FOUND" || code === "LOBBY_CLOSED") {
        backToPlay(nav, m);
        return;
      }
    };

    c.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        const roomCode = String(payload?.room_code || payload?.roomCode || "");
        // Per your spec: redirect /play/game when game starts
        if (roomCode) {
          nav(`/play/game/${encodeURIComponent(roomCode)}`, { replace: true });
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
        await c.connectPlay(joinCode);
        await c.playHello(deviceId);

        // start ping loop (5s per your spec)
        pingTimerRef.current = window.setInterval(async () => {
          try {
            await c.ping(joinCode, deviceId, playerId, token);
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
  }, [joinCode, deviceId, playerId, token]);

  const me = useMemo(() => {
    if (!st) return null;
    return st.players.find((p) => p.id === playerId) || null;
  }, [st, playerId]);

  async function changePlayer() {
    const c = clientRef.current;
    if (!c) return;

    try {
      await c.releasePlayer(joinCode, deviceId, playerId, token);
    } catch {
      // even if release fails, force local reset
    }
    purgePlayClaim();
    nav(`/play/choose/${encodeURIComponent(joinCode)}`, { replace: true });
  }

  async function submitName() {
    const c = clientRef.current;
    if (!c) return;

    const next = String(nameDraft || "").slice(0, 30);
    setNameDraft(next);

    try {
      await c.setPlayerName(joinCode, deviceId, playerId, token, next);
      setErr("");
    } catch (e: any) {
      setErr("Impossible de renommer");
    }
  }

  function goCapturePhoto() {
    // adapte si ton routeur est différent
    nav("/play/photo");
  }

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <button className={styles.backBtn} onClick={changePlayer}>
          Changer de player
        </button>
        <div className={styles.code}>Code: {joinCode}</div>
      </div>

      <div className={styles.card}>
        <h1 className={styles.title}>Connecté</h1>
        <div className={styles.subtitle}>Le jeu va bientôt commencer.</div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <div className={styles.meRow}>
          <div className={styles.avatar}>
            {me?.photo_url ? <img src={me.photo_url} alt="" /> : null}
          </div>
          <div className={styles.meInfo}>
            <div className={styles.meName}>{me?.name || "—"}</div>
            <div className={styles.meStatus}>{me?.status === "afk" ? "AFK" : "Connecté"}</div>
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
            Valider
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
