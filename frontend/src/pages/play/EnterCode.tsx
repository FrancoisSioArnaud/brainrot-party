// frontend/src/pages/play/EnterCode.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LobbyClient } from "../../ws/lobbyClient";
import {
  clearClaim,
  getClaim,
  getCurrentRoomCode,
  getOrCreateDeviceId,
  isValidJoinCode,
  normalizeJoinCode,
  readAndClearLastError,
  setCurrentRoomCode,
  wipePlayStateExceptDevice,
} from "../../lib/playStorage";
import styles from "./EnterCode.module.css";

export default function PlayEnterCode() {
  const nav = useNavigate();
  const [params] = useSearchParams();

  const initialFromQuery = useMemo(() => normalizeJoinCode(params.get("code") || ""), [params]);
  const [code, setCode] = useState<string>(initialFromQuery);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const clientRef = useRef<LobbyClient | null>(null);

  // Show last error from redirects (choose/wait -> /play)
  useEffect(() => {
    const last = readAndClearLastError();
    if (last) setError(last);
  }, []);

  useEffect(() => {
    // Auto attempt join when /play?code=XXXXXX is provided and valid
    if (initialFromQuery && isValidJoinCode(initialFromQuery)) {
      void tryJoin(initialFromQuery, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFromQuery]);

  async function tryJoin(raw: string, replace: boolean) {
    const joinCode = normalizeJoinCode(raw);
    setCode(joinCode);

    if (!isValidJoinCode(joinCode)) {
      setError("Code invalide (6 caractères).");
      return;
    }

    if (busy) return;
    setBusy(true);
    setError("");

    const deviceId = getOrCreateDeviceId();

    const c = new LobbyClient();
    clientRef.current = c;

    let closedMsg: string | null = null;
    c.onEvent = (type) => {
      if (type === "lobby_closed") closedMsg = "Partie démarrée / room fermée";
    };

    try {
      await c.connectPlay(joinCode);
      await c.playHello(deviceId);

      // WS OK: now we can decide whether this is a new lobby
      const prevRoom = getCurrentRoomCode();
      if (!prevRoom || prevRoom !== joinCode) {
        wipePlayStateExceptDevice();
        setCurrentRoomCode(joinCode);
        nav("/play/choose", { replace });
        return;
      }

      // Same lobby: attempt resume
      const { player_id, player_session_token } = getClaim();
      if (player_id && player_session_token) {
        try {
          await c.ping(joinCode, deviceId, player_id, player_session_token);
          nav("/play/wait", { replace });
          return;
        } catch (e: any) {
          const code = String(e?.code || "");
          if (code === "TOKEN_INVALID") {
            clearClaim();
            nav("/play/choose", { replace });
            return;
          }
          // any other error: fall back to choose
          clearClaim();
          nav("/play/choose", { replace });
          return;
        }
      }

      nav("/play/choose", { replace });
    } catch (e: any) {
      // Prefer explicit lobby close message if received
      if (closedMsg) {
        setError(closedMsg);
        return;
      }

      const code = String(e?.code || "");
      if (code === "LOBBY_NOT_FOUND") {
        setError("Room introuvable");
        return;
      }
      setError("Connexion lobby impossible");
    } finally {
      setBusy(false);
      try {
        c.ws.disconnect();
      } catch {}
      clientRef.current = null;
    }
  }

  function onJoin() {
    void tryJoin(code, false);
  }

  const canJoin = isValidJoinCode(code);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Rejoindre une partie</h1>

        <label className={styles.label} htmlFor="join_code">
          Code
        </label>

        <input
          id="join_code"
          className={styles.input}
          value={code}
          onChange={(e) => {
            setError("");
            setCode(normalizeJoinCode(e.target.value));
          }}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="AB12CD"
          maxLength={6}
          disabled={busy}
        />

        {error ? <div className={styles.error}>{error}</div> : null}

        <button className={styles.button} disabled={!canJoin || busy} onClick={onJoin}>
          Rejoindre
        </button>
      </div>
    </div>
  );
}
