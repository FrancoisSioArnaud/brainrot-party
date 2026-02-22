import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import {
  clearClaimOnly,
  getClaim,
  getCurrentRoomCode,
  getOrCreateDeviceId,
  setLastError,
  wipePlayStateExceptDevice,
} from "../../lib/playStorage";
import styles from "./Wait.module.css";

export default function PlayWait() {
  const nav = useNavigate();

  const joinCode = useMemo(() => getCurrentRoomCode(), []);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const { player_id, player_session_token } = useMemo(() => getClaim(), []);

  const clientRef = useRef<LobbyClient | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [meName, setMeName] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");

  // Guard: must have joinCode + claim
  useEffect(() => {
    if (!joinCode) {
      nav("/play", { replace: true });
      return;
    }
    if (!player_id || !player_session_token) {
      nav("/play/choose", { replace: true });
      return;
    }
  }, [joinCode, player_id, player_session_token, nav]);

  useEffect(() => {
    if (!joinCode || !player_id || !player_session_token) return;

    const c = new LobbyClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      const me = s.players.find((p) => p.id === player_id);
      if (me && meName.trim() === "") setMeName(me.name || "");
      setErr("");
    };

    c.onError = (code, message) => {
      if (code === "TOKEN_INVALID") {
        clearClaimOnly();
        nav("/play/choose", { replace: true });
        return;
      }
      if (code === "LOBBY_NOT_FOUND") {
        setLastError("Room introuvable");
        wipePlayStateExceptDevice();
        nav("/play", { replace: true });
        return;
      }
      setErr(message || "Erreur");
    };

    c.onEvent = (type, payload) => {
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

      if (type === "lobby_closed") {
        const reason = String(payload?.reason || "");
        const roomCode = String(payload?.room_code || "");
        if (reason === "start_game" && roomCode) {
          nav(`/play/game/${roomCode}`, { replace: true });
          return;
        }

        setLastError("Partie démarrée / room fermée");
        wipePlayStateExceptDevice();
        nav("/play", { replace: true });
        return;
      }
    };

    (async () => {
      try {
        await c.connectPlay(joinCode);
        await c.playHello(deviceId);

        // Validation unique à l’entrée (plus de ping loop)
        await c.resumePlayer(joinCode, deviceId, player_id, player_session_token);
      } catch (e: any) {
        const code = String(e?.code || "");
        if (code === "TOKEN_INVALID") {
          clearClaimOnly();
          nav("/play/choose", { replace: true });
          return;
        }
        setLastError("Connexion lobby impossible");
        nav("/play", { replace: true });
      }
    })();

    return () => c.ws.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinCode, deviceId, player_id, player_session_token, nav]);

  async function saveName() {
    if (!joinCode || !player_id || !player_session_token) return;
    const name = meName.trim();
    if (!name) {
      setErr("Nom vide");
      return;
    }
    if (name.length > 30) {
      setErr("Max 30 caractères");
      return;
    }

    setSaving(true);
    setErr("");
    try {
      await clientRef.current?.setPlayerName(joinCode, deviceId, player_id, player_session_token, name);
    } catch {
      setErr("Impossible d’enregistrer");
    } finally {
      setSaving(false);
    }
  }

  async function resetName() {
    if (!joinCode || !player_id || !player_session_token) return;
    setSaving(true);
    setErr("");
    try {
      await clientRef.current?.resetPlayerName(joinCode, deviceId, player_id, player_session_token);
    } catch {
      setErr("Impossible de reset");
    } finally {
      setSaving(false);
    }
  }

  async function changePlayer() {
    if (!joinCode || !player_id || !player_session_token) return;

    setSaving(true);
    setErr("");
    try {
      await clientRef.current?.releasePlayer(joinCode, deviceId, player_id, player_session_token);
    } catch {
      // même si ça fail, on force le retour choose (MVP)
    } finally {
      // décision: on garde le joinCode, on wipe uniquement le claim
      clearClaimOnly();
      setSaving(false);
      nav("/play/choose", { replace: true });
    }
  }

  const me = st?.players.find((p) => p.id === player_id) || null;

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.title}>Connecté</div>
        <div className={styles.sub}>En attente du démarrage…</div>

        <div className={styles.meRow}>
          <div className={styles.avatar}>
            {me?.photo_url ? <img src={me.photo_url} alt="" /> : null}
          </div>
          <div className={styles.meInfo}>
            <div className={styles.meName}>{me?.name || "—"}</div>
            <div className={styles.code}>
              Code: <span className={styles.codeVal}>{joinCode || "—"}</span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Mon nom</div>
          <input
            className={styles.input}
            value={meName}
            onChange={(e) => {
              setErr("");
              setMeName(e.target.value);
            }}
            maxLength={30}
            disabled={saving}
          />

          <div className={styles.row}>
            <button className={styles.btn} disabled={saving} onClick={saveName}>
              Enregistrer
            </button>
            <button className={styles.btnSecondary} disabled={saving} onClick={resetName}>
              Reset
            </button>
          </div>
        </div>

        {/* Photo upload: laissé volontairement minimal (à brancher sur ton endpoint HTTP).
            Si tu veux, je te fournis la version complète avec input capture + POST multipart.
        */}
        <div className={styles.section}>
          <div className={styles.label}>Photo</div>
          <div className={styles.hint}>Camera only (à brancher)</div>
        </div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <button className={styles.change} disabled={saving} onClick={changePlayer}>
          Changer de player
        </button>
      </div>
    </div>
  );
}
