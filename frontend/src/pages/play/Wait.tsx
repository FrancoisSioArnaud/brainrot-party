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

function centerCropSquareToJpegBlob(
  videoEl: HTMLVideoElement,
  size = 400,
  quality = 0.85
): Promise<Blob> {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return Promise.reject(new Error("NO_VIDEO_DIMENSIONS"));

  const side = Math.min(vw, vh);
  const sx = Math.floor((vw - side) / 2);
  const sy = Math.floor((vh - side) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("NO_CANVAS_CTX"));

  ctx.drawImage(videoEl, sx, sy, side, side, 0, 0, size, size);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("TOBLOB_FAILED"))),
      "image/jpeg",
      quality
    );
  });
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

  // camera modal
  const [camOpen, setCamOpen] = useState(false);
  const [camBusy, setCamBusy] = useState(false);
  const [camErr, setCamErr] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
        const reason = String(payload?.reason || "");
        if (reason === "start_game") {
          const roomCode = String(payload?.room_code || joinCode || "");
          // ✅ Go to game
          nav(`/play/game/${encodeURIComponent(roomCode)}`, { replace: true });
          return;
        }
        setErr("Lobby fermé");
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
  }, [me?.id]);

  // ping every 5s
  useEffect(() => {
    if (!joinCode || !playerId || !token) return;
    const c = clientRef.current;
    if (!c) return;

    const t = setInterval(() => {
      c.ping(deviceId, playerId, token).catch(() => {});
    }, 5000);

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
      localStorage.removeItem("brp_player_id");
      localStorage.removeItem("brp_player_session_token");
    }
    nav("/play/choose", { replace: true });
  }

  async function openCamera() {
    setCamErr("");
    setCamBusy(true);
    setCamOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
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
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function uploadCapturedPhoto() {
    if (!joinCode || !playerId || !token) return;
    const v = videoRef.current;
    if (!v) return;

    setCamErr("");
    setCamBusy(true);

    try {
      const blob = await centerCropSquareToJpegBlob(v, 400, 0.85);

      const form = new FormData();
      form.append("photo", blob, "photo.jpg");

      const res = await fetch(`/lobby/${joinCode}/players/${playerId}/photo`, {
        method: "POST",
        headers: {
          "x-device-id": deviceId,
          "x-player-token": token
        },
        body: form
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
      setCamErr("Capture impossible");
    } finally {
      setCamBusy(false);
    }
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
            maxLength={32}
          />

          <div className={styles.row}>
            <button className={styles.btn} onClick={saveName}>Enregistrer</button>
            <button className={styles.btn} onClick={resetName}>Reset nom</button>
          </div>
        </div>

        <div className={styles.photoBox}>
          <div className={styles.label}>Photo</div>
          <div className={styles.row}>
            <button className={styles.btn} onClick={openCamera}>Prendre une photo</button>
          </div>
          <div className={styles.photoHint}>Camera only · crop carré centré · 400×400</div>
        </div>

        <div className={styles.row}>
          <button className={styles.btnDanger} onClick={changePlayer}>Changer de player</button>
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
              <button className={styles.btn} disabled={camBusy} onClick={uploadCapturedPhoto}>Capturer</button>
              <button className={styles.btnDanger} disabled={camBusy} onClick={closeCamera}>Annuler</button>
            </div>

            {camBusy ? <div className={styles.photoHint}>Traitement…</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
