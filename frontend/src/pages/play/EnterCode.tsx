import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import styles from "./EnterCode.module.css";
import { LobbyClient } from "../../ws/lobbyClient";
import { popOneShotError, setOneShotError } from "../../utils/playSession";

function normalizeCode(input: string) {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
}

const JOIN_CODE_KEY = "brp_join_code";
const JOIN_CODE_AT_KEY = "brp_join_code_saved_at";
const JOIN_CODE_TTL_MS = 8 * 60 * 60 * 1000; // 8h

function setJoinCode(code: string) {
  localStorage.setItem(JOIN_CODE_KEY, code);
  localStorage.setItem(JOIN_CODE_AT_KEY, String(Date.now()));
}

function getFreshJoinCode(): string | null {
  const code = localStorage.getItem(JOIN_CODE_KEY);
  const atRaw = localStorage.getItem(JOIN_CODE_AT_KEY);
  if (!code || !atRaw) return null;

  const at = Number(atRaw);
  if (!Number.isFinite(at) || Date.now() - at > JOIN_CODE_TTL_MS) {
    localStorage.removeItem(JOIN_CODE_KEY);
    localStorage.removeItem(JOIN_CODE_AT_KEY);
    return null;
  }
  return code;
}

function getOrCreateDeviceId(): string {
  const k = "brp_device_id";
  const cur = localStorage.getItem(k);
  if (cur) return cur;
  const id = crypto.randomUUID();
  localStorage.setItem(k, id);
  return id;
}

function mapError(code: string, message: string) {
  // serveur envoie déjà des messages FR; on force 2-3 cas
  if (code === "LOBBY_NOT_FOUND") return "Room introuvable";
  if (code === "LOBBY_CLOSED") return "Partie démarrée / room fermée";
  if (message) return message;
  return "Erreur";
}

export default function PlayEnterCode() {
  const nav = useNavigate();
  const [sp] = useSearchParams();

  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const prefill = useMemo(() => normalizeCode(sp.get("code") || ""), [sp]);

  const [code, setCode] = useState(prefill);
  const [err, setErr] = useState<string>(() => popOneShotError() || "");
  const [busy, setBusy] = useState(false);

  const clientRef = useRef<LobbyClient | null>(null);
  const attemptedAutoRef = useRef(false);

  async function tryJoin(joinCode: string) {
    const c = new LobbyClient();
    clientRef.current = c;

    return new Promise<void>(async (resolve, reject) => {
      let done = false;

      c.onError = (code, message) => {
        if (done) return;
        done = true;
        reject(new Error(mapError(String(code || "ERROR"), String(message || ""))));
      };

      c.onEvent = (type, payload) => {
        if (type === "lobby_closed") {
          if (done) return;
          done = true;
          const reason = String(payload?.reason || "");
          if (reason === "start_game") reject(new Error("Partie démarrée / room fermée"));
          else reject(new Error("Lobby fermé"));
        }
      };

      c.onState = () => {
        // OK: lobby existe + snapshot reçu
        // On continue le flow après playHello
      };

      try {
        await c.connectPlay(joinCode);
        await c.playHello(deviceId);

        // ✅ join_code validé => on le garde (TTL 8h)
        setJoinCode(joinCode);

        // Reconnexion: si on a déjà un claim local, on tente un ping.
        const pid = localStorage.getItem("brp_player_id");
        const tok = localStorage.getItem("brp_player_session_token");

        if (pid && tok) {
          try {
            await c.ping(deviceId, pid, tok);
            // ping OK => toujours connecté
            resolve();
            nav("/play/wait", { replace: true });
            return;
          } catch {
            // token invalide => clear claim et choix player
            localStorage.removeItem("brp_player_id");
            localStorage.removeItem("brp_player_session_token");
            resolve();
            nav("/play/choose", { replace: true });
            return;
          }
        }

        resolve();
        nav("/play/choose", { replace: true });
      } catch (e: any) {
        if (done) return;
        done = true;
        reject(e);
      }
    });
  }

  // Auto-continue si QR code complet
  useEffect(() => {
    if (attemptedAutoRef.current) return;
    if (prefill.length !== 6) return;
    attemptedAutoRef.current = true;

    setBusy(true);
    setErr("");

    tryJoin(prefill)
      .catch((e: any) => setErr(String(e?.message || "Connexion lobby impossible")))
      .finally(() => setBusy(false));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // Si on a un join_code “frais” en local, on peut pré-remplir (sans auto)
  useEffect(() => {
    if (prefill) return;
    const saved = getFreshJoinCode();
    if (saved && saved !== code) setCode(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup WS si on quitte
  useEffect(() => {
    return () => {
      try {
        clientRef.current?.ws.disconnect();
      } catch {}
      clientRef.current = null;
    };
  }, []);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Rejoindre</h1>

      {err ? (
        <div style={{ marginBottom: 10, padding: 12, borderRadius: 14, border: "1px solid var(--border)" }}>
          {err}
        </div>
      ) : null}

      <input
        className={styles.input}
        value={code}
        onChange={(e) => setCode(normalizeCode(e.target.value))}
        placeholder="AB12CD"
        maxLength={6}
        disabled={busy}
      />

      <button
        className={styles.primary}
        disabled={busy || code.length !== 6}
        onClick={() => {
          const c = normalizeCode(code);
          if (c.length !== 6) return;

          setBusy(true);
          setErr("");

          tryJoin(c)
            .catch((e: any) => {
              const m = String(e?.message || "Connexion lobby impossible");
              setErr(m);
              // on garde le champ rempli, comme demandé
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Connexion…" : "Rejoindre"}
      </button>

      <button
        style={{
          marginTop: 10,
          background: "transparent",
          border: "none",
          color: "var(--muted)",
          fontWeight: 900,
          cursor: "pointer",
          textDecoration: "underline",
        }}
        disabled={busy}
        onClick={() => {
          // reset complet du flow play
          localStorage.removeItem("brp_player_id");
          localStorage.removeItem("brp_player_session_token");
          setOneShotError("Code réinitialisé");
          nav("/play", { replace: true });
          setErr("");
          setCode("");
        }}
      >
        Changer de code
      </button>
    </div>
  );
}
