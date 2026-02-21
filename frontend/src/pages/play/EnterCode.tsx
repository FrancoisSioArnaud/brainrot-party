// frontend/src/pages/play/EnterCode.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import styles from "./EnterCode.module.css"; // adapte si tu n'as pas ce module

function normalizeCode(input: string) {
  return (input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function isValidCode(code: string) {
  return code.length === 6;
}

function newUuid(): string {
  return crypto.randomUUID();
}

function purgePlayClaim() {
  localStorage.removeItem("brp_player_id");
  localStorage.removeItem("brp_player_session_token");
}

function applyLobbySwitch(nextCode: string) {
  const prevCode = localStorage.getItem("brp_join_code");

  // ✅ If lobby changes => new device_id (per your decision: not global)
  if (prevCode && prevCode !== nextCode) {
    localStorage.setItem("brp_device_id", newUuid());
    localStorage.setItem("brp_device_id_scope", nextCode);
    purgePlayClaim();
  }

  // Ensure device id exists and is scoped to this join_code
  const scope = localStorage.getItem("brp_device_id_scope");
  const cur = localStorage.getItem("brp_device_id");
  if (!cur || !scope || scope !== nextCode) {
    localStorage.setItem("brp_device_id", newUuid());
    localStorage.setItem("brp_device_id_scope", nextCode);
  }

  localStorage.setItem("brp_join_code", nextCode);
}

function readAndClearLastError(): string {
  const k = "brp_play_last_error";
  const v = localStorage.getItem(k) || "";
  if (v) localStorage.removeItem(k);
  return v;
}

export default function PlayEnterCode() {
  const nav = useNavigate();
  const [params] = useSearchParams();

  const initialFromQuery = useMemo(() => normalizeCode(params.get("code") || ""), [params]);
  const [code, setCode] = useState<string>(initialFromQuery);
  const [error, setError] = useState<string>("");

  // Show last error from redirects (choose/wait -> /play)
  useEffect(() => {
    const last = readAndClearLastError();
    if (last) setError(last);
  }, []);

  // Auto-continue when /play?code=XXXXXX is provided and valid
  useEffect(() => {
    if (initialFromQuery && isValidCode(initialFromQuery)) {
      setError("");
      applyLobbySwitch(initialFromQuery);
      nav(`/play/choose/${encodeURIComponent(initialFromQuery)}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFromQuery]);

  function onJoin() {
    const c = normalizeCode(code);
    setCode(c);

    if (!isValidCode(c)) {
      setError("Code invalide (6 caractères).");
      return;
    }

    setError("");
    applyLobbySwitch(c);
    nav(`/play/choose/${encodeURIComponent(c)}`);
  }

  const canJoin = isValidCode(normalizeCode(code));

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
            setCode(normalizeCode(e.target.value));
          }}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="AB12CD"
          maxLength={6}
        />

        {error ? <div className={styles.error}>{error}</div> : null}

        <button className={styles.button} disabled={!canJoin} onClick={onJoin}>
          Rejoindre
        </button>
      </div>
    </div>
  );
}
