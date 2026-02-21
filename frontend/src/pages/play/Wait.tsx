import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";
import styles from "./Wait.module.css";
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
const JOIN_CODE_TTL_MS = 8 * 60 * 60 * 1000;

function getFreshJoinCode(): string | null {
  const code = localStorage.getItem(JOIN_CODE_KEY);
  const atRaw = localStorage.getItem(JOIN_CODE_AT_KEY);
  if (!code) return null;
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

function readPlayerId(): string | null {
  return localStorage.getItem("brp_player_id");
}
function readToken(): string | null {
  return localStorage.getItem("brp_player_session_token");
}

export default function PlayWait() {
  const nav = useNavigate();

  const joinCode = useMemo(() => getFreshJoinCode(), []);
  const deviceId = useMemo(() => getOrCreateDeviceId(), []);
  const playerId = useMemo(() => readPlayerId(), []);
  const token = useMemo(() => readToken(), []);

  const clientRef = useRef<LobbyClient | null>(null);

  const [st, setSt] = useState<LobbyState | null>(null);
  const [err, setErr] = useState<string>("");

  const me = useMemo(() => {
    if (!st || !playerId) return null;
    return st.players.find((p) => p.id === playerId) || null;
  }, [st, playerId]);

  // ===== name =====
  const [nameDraft, setNameDraft] = useState<string>("");
  const [nameBusy, setNameBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    setNameDraft(me.name || "");
  }, [me?.id]);

  // ===== camera capture (no crop step) =====
  const [camOpen, setCamOpen] = useState(false);
  const [camBusy, setCamBusy] = useState(false);
  const [camErr, setCamErr] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function stopStream() {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function openCamera() {
    setCamErr("");
    setCamBusy(true);
    setCamOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      streamRef.current = stream;

      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
    } catch {
      setCamErr("Accès caméra refusé");
    } finally {
      setCamBusy(false);
    }
  }

  function closeCamera() {
    setCamOpen(false);
    setCamErr("");
    setCamBusy(false);
    stopStream();
  }

  async function captureSquareBlobFromVideo(videoEl: HTMLVideoElement): Promise<Blob> {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) throw new Error("NO_VIDEO_DIMENSIONS");

    // The UI is a 1:1 square with object-fit: cover.
    // We save the same thing: a centered square crop of the raw frame, resized to 400x400.
    const side = Math.min(vw, vh);
    const sx = Math.floor((vw - side) / 2);
    const sy = Math.floor((vh - side) / 2);

    const out = document.createElement("canvas");
    out.width = 400;
    out.height = 400;

    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("NO_CANVAS_CTX");

    ctx.drawImage(videoEl, sx, sy, side, side, 0, 0, 400, 400);

    const blob: Blob = await new Promise((resolve, reject) => {
      out.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("TOBLOB_FAILED"))),
        "image/jpeg",
        0.88
      );
    });

    return blob;
  }

  async function captureAndUpload() {
    if (!joinCode || !playerId || !token) return;
    const v = videoRef.current;
    if (!v) return;

    setCamErr("");
    setCamBusy(true);

    try {
      const blob = await captureSquareBlobFromVideo(v);

      const form = new FormData();
      form.append("photo", blob, "photo.jpg");

      const res = await fetch(`/lobby/${joinCode}/players/${playerId}/photo`, {
        method: "POST",
        headers: {
          "x-device-id": deviceId,
          "x-player-token": token,
        },
        body: form,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const code = data?.error ? String(data.error) : "UPLOAD_FAILED";
        if (code === "UNSUPPORTED_MIME") setCamErr("Format image non supporté");
        else if (code === "TOKEN_INVALID") setCamErr("Session invalide (re-choisis ton player)");
        else setCamErr("Upload échoué");
        return;
      }

      closeCamera();
    } catch {
      setCamErr("Capture / upload échoué");
    } finally {
      setCamBusy(false);
    }
  }

  // ===== Lobby connection =====
  useEffect(() => {
    if (!joinCode) {
      setOneShotError("Code expiré. Rejoins à nouveau la room.");
      nav("/play", { replace: true });
      return;
    }
    if (!playerId || !token) {
      nav("/play/choose", { replace: true });
      return;
    }

    localStorage.setItem(JOIN_CODE_AT_KEY, String(Date.now()));

    const c = new LobbyClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setErr("");
    };

    c.onError = (_code, message) => {
      setErr(message || "Erreur");
    };

    c.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        const reason = String(payload?.reason || "");
        if (reason === "start_game") {
          const roomCode = String(payload?.room_code || joinCode || "");
          nav(`/play/game/${encodeURIComponent(roomCode)}`, { replace: true });
          return;
        }
        setOneShotError("Lobby fermé");
        nav("/play", { replace: true });
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

        await c.ping(deviceId, playerId, token);
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
  }, [joinCode, deviceId, playerId, token, nav]);

  // ping every 5s
  useEffect(() => {
    if (!joinCode || !playerId || !token) return;
    const c = clientRef.current;
    if (!c) return;

    const t = setInterval(() => {
      c.ping(deviceId, playerId, token).catch(() => {});
    }, 5000);

    return () => clearInterval(t);
  }, [joinCode, deviceId, playerId, token]);

  async function saveName() {
    if (!playerId || !token) return;
    const c = clientRef.current;
    if (!c) return;

    const name = nameDraft;
    const trimmed = name.length > 30 ? name.slice(0, 30) : name;

    setNameBusy(true);
    try {
      await c.setPlayerName(deviceId, playerId, token, trimmed);
      setErr("");
    } catch {
      setErr("Impossible de renommer");
    } finally {
      setNameBusy(false);
    }
  }

  async function changePlayer() {
    if (!playerId || !token) return;
    const c = clientRef.current;

    try {
      await c?.releasePlayer(deviceId, playerId, token);
    } catch {}

    localStorage.removeItem("brp_player_id");
    localStorage.removeItem("brp_player_session_token");
    nav("/play/choose", { replace: true });
  }

  if (!joinCode) return null;

  if (!playerId || !token) {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.title}>Non connecté</div>
          <button className={styles.btn} onClick={() => nav("/play/choose")}>
            Choisir un player
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.topRow}>
          <button className={styles.topBack} onClick={changePlayer}>
            Changer de player
          </button>
        </div>

        <div className={styles.title}>Connecté. Le jeu va bientôt commencer.</div>
        <div className={styles.sub}>
          Code: <span className={styles.code}>{joinCode}</span>
        </div>

        {err ? <div className={styles.err}>{err}</div> : null}

        <div className={styles.meRow}>
          <div className={styles.avatar}>{me?.photo_url ? <img src={me.photo_url} alt="" /> : null}</div>

          <div className={styles.meInfo}>
            <div className={styles.meName}>{me?.name || "—"}</div>
            <div className={styles.meStatus}>
              {me?.status === "connected"
                ? "Connecté"
                : me?.status === "afk"
                ? `AFK (${me.afk_seconds_left ?? "?"}s)`
                : me?.status === "free"
                ? "Libre"
                : "Désactivé"}
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
            maxLength={30}
            disabled={nameBusy}
          />

          <div className={styles.row}>
            <button className={styles.btn} disabled={nameBusy} onClick={saveName}>
              {nameBusy ? "…" : "Enregistrer"}
            </button>
          </div>
        </div>

        <div className={styles.photoBox}>
          <div className={styles.label}>Photo</div>
          <div className={styles.row}>
            <button className={styles.btn} onClick={openCamera}>
              Prendre une photo
            </button>
          </div>
        </div>
      </div>

      {camOpen ? (
        <div className={styles.modalBackdrop} onClick={closeCamera}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Photo</div>

            {camErr ? <div className={styles.camErr}>{camErr}</div> : null}

            <div className={styles.videoWrap}>
              <video ref={videoRef} className={styles.video} playsInline muted />
              <div className={styles.cropGuide} />
            </div>

            <div className={styles.modalRow}>
              <button className={styles.btn} disabled={camBusy} onClick={captureAndUpload}>
                {camBusy ? "…" : "Capturer"}
              </button>
              <button className={styles.btnDanger} disabled={camBusy} onClick={closeCamera}>
                Annuler
              </button>
            </div>

            <div className={styles.photoHint}>La photo enregistrée correspond au carré visible.</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
