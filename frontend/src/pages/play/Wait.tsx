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

export default function PlayWait() {
  const nav = useNavigate();

  const roomCode = useMemo(() => getCurrentRoomCode(), []);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const claim = useMemo(() => getClaim(), []);

  const clientRef = useRef<LobbyClient | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [err, setErr] = useState<string>("");

  const [nameDraft, setNameDraft] = useState<string>("");

  // Guards
  useEffect(() => {
    if (!roomCode) {
      nav("/play", { replace: true });
    }
  }, [roomCode, nav]);

  useEffect(() => {
    if (roomCode && !claim) {
      nav("/play/choose", { replace: true });
    }
  }, [roomCode, claim, nav]);

  if (!roomCode || !claim) return null;

  const playerId = claim.player_id;
  const token = claim.player_session_token;

  useEffect(() => {
    const c = new LobbyClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setErr("");
      // init nameDraft from state (best effort)
      const me = s.players?.find((p) => p.id === playerId);
      if (me && !nameDraft) setNameDraft(String(me.name || ""));
    };

    c.onError = (code, message) => {
      if (code === "TOKEN_INVALID") {
        clearClaim();
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
      if (type === "lobby_closed") {
        const reason = String(payload?.reason || "");
        const rc = String(payload?.room_code || "");

        if (reason === "start_game" && rc) {
          nav(`/play/game/${rc}`, { replace: true });
          return;
        }

        setLastError("Partie démarrée / room fermée");
        wipePlayStateExceptDevice();
        nav("/play", { replace: true });
        return;
      }

      if (type === "player_kicked") {
        setLastError("Tu as été déconnecté");
        wipePlayStateExceptDevice();
        nav("/play", { replace: true });
        return;
      }
    };

    let pingTimer: any = null;

    (async () => {
      try {
        await c.connectPlay(roomCode);
        await c.playHello(deviceId);

        // validate claim
        await c.ping(roomCode, deviceId, playerId, token);

        // ping every 5s
        pingTimer = setInterval(async () => {
          try {
            await c.ping(roomCode, deviceId, playerId, token);
          } catch (e: any) {
            const code = String(e?.code || "");
            if (code === "TOKEN_INVALID") {
              clearClaim();
              nav("/play/choose", { replace: true });
              return;
            }
          }
        }, 5000);
      } catch {
        setLastError("Connexion lobby impossible");
        nav("/play", { replace: true });
      }
    })();

    return () => {
      if (pingTimer) clearInterval(pingTimer);
      c.ws.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, deviceId, playerId, token, nav]);

  async function changePlayer() {
    try {
      const c = clientRef.current;
      if (!c) return;
      await c.releasePlayer(roomCode, deviceId, playerId, token);
    } catch {
      // ignore
    } finally {
      clearClaim();
      nav("/play/choose", { replace: true });
    }
  }

  async function saveName() {
    try {
      const next = String(nameDraft || "").slice(0, 30);
      const c = clientRef.current;
      if (!c) return;
      await c.setPlayerName(roomCode, deviceId, playerId, token, next);
    } catch {
      setErr("Impossible d’enregistrer");
    }
  }

  // Photo: on ne touche pas le système actuel (selon ta consigne)
  // On garde la UI existante si tu avais déjà un composant.
  // Ici on met juste un placeholder bloc.
  const myPlayer = st?.players?.find((p) => p.id === playerId) || null;

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.top}>
          <button className={styles.backBtn} onClick={changePlayer}>
            Changer de player
          </button>
        </div>

        <div className={styles.title}>Connecté…</div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <div className={styles.section}>
          <div className={styles.label}>Player</div>
          <div className={styles.row}>
            <div className={styles.avatar}>
              {myPlayer?.photo_url ? <img src={myPlayer.photo_url} alt="" /> : null}
            </div>
            <div className={styles.meta}>
              <div className={styles.name}>{myPlayer?.name || "—"}</div>
              <div className={styles.small}>
                {roomCode} · {playerId}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.label}>Renommer</div>
          <div className={styles.row}>
            <input
              className={styles.input}
              value={nameDraft}
              maxLength={30}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Ton nom"
            />
            <button className={styles.saveBtn} onClick={saveName}>
              Enregistrer
            </button>
          </div>
        </div>

        {/* Photo upload UI laissée telle quelle: si tu avais déjà un bloc photo ici,
            recolle-le à cet endroit. */}
      </div>
    </div>
  );
}
