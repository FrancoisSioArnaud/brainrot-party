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

async function captureVideoFrameToImage(videoEl: HTMLVideoElement): Promise<HTMLImageElement> {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) throw new Error("NO_VIDEO_DIMENSIONS");

  const canvas = document.createElement("canvas");
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CANVAS_CTX");
  ctx.drawImage(videoEl, 0, 0, vw, vh);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const img = new Image();
  img.src = dataUrl;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
  });

  return img;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
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

  // init draft name from server once (or when player changes)
  useEffect(() => {
    if (!me) return;
    setNameDraft(me.name || "");
  }, [me?.id]);

  // ===== camera + crop =====
  const [camOpen, setCamOpen] = useState(false);
  const [camStep, setCamStep] = useState<"live" | "crop">("live");
  const [camBusy, setCamBusy] = useState(false);
  const [camErr, setCamErr] = useState<string>("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cropBoxRef = useRef<HTMLDivElement | null>(null);
  const [cropImg, setCropImg] = useState<HTMLImageElement | null>(null);

  // crop transform (px relative to center) + zoom factor
  const [cropTx, setCropTx] = useState(0);
  const [cropTy, setCropTy] = useState(0);
  const [cropZoom, setCropZoom] = useState(1); // user zoom multiplier

  const dragRef = useRef<{ down: boolean; sx: number; sy: number; tx: number; ty: number } | null>(null);

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
    setCamStep("live");
    setCropImg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" }, // camera only
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
    setCamStep("live");
    setCropImg(null);
    setCropTx(0);
    setCropTy(0);
    setCropZoom(1);
    stopStream();
  }

  async function captureAndGoCrop() {
    const v = videoRef.current;
    if (!v) return;

    setCamErr("");
    setCamBusy(true);

    try {
      const img = await captureVideoFrameToImage(v);
      setCropImg(img);
      setCropTx(0);
      setCropTy(0);
      setCropZoom(1);
      setCamStep("crop");
      // on peut arrêter le stream maintenant (plus stable)
      stopStream();
    } catch {
      setCamErr("Capture impossible");
    } finally {
      setCamBusy(false);
    }
  }

  function computeCoverScale(iw: number, ih: number, box: number) {
    return Math.max(box / iw, box / ih);
  }

  function clampCrop(tx: number, ty: number, zoom: number) {
    const boxEl = cropBoxRef.current;
    const img = cropImg;
    if (!boxEl || !img) return { tx, ty, zoom };

    const box = boxEl.clientWidth; // carré
    const iw = img.naturalWidth || (img as any).width || 1;
    const ih = img.naturalHeight || (img as any).height || 1;

    const base = computeCoverScale(iw, ih, box);
    const s = base * zoom;
    const dw = iw * s;
    const dh = ih * s;

    // image position: centered + (tx,ty)
    // Need to ensure it still covers the square -> clamp translate
    const minTx = (box - dw) / 2;
    const maxTx = (dw - box) / 2;
    const minTy = (box - dh) / 2;
    const maxTy = (dh - box) / 2;

    // If dw<box (shouldn't with cover), still clamp safely
    const clampedTx = clamp(tx, -maxTx, -minTx);
    const clampedTy = clamp(ty, -maxTy, -minTy);

    return { tx: clampedTx, ty: clampedTy, zoom };
  }

  function onCropPointerDown(e: React.PointerEvent) {
    if (!cropImg) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { down: true, sx: e.clientX, sy: e.clientY, tx: cropTx, ty: cropTy };
  }

  function onCropPointerMove(e: React.PointerEvent) {
    if (!dragRef.current?.down) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;

    const next = clampCrop(dragRef.current.tx + dx, dragRef.current.ty + dy, cropZoom);
    setCropTx(next.tx);
    setCropTy(next.ty);
  }

  function onCropPointerUp() {
    dragRef.current = null;
  }

  function onZoomChange(nextZoom: number) {
    const z = clamp(nextZoom, 1, 3);
    const next = clampCrop(cropTx, cropTy, z);
    setCropZoom(next.zoom);
    setCropTx(next.tx);
    setCropTy(next.ty);
  }

  async function uploadCroppedPhoto() {
    if (!joinCode || !playerId || !token) return;
    if (!cropImg) return;

    const boxEl = cropBoxRef.current;
    if (!boxEl) return;

    setCamErr("");
    setCamBusy(true);

    try {
      const box = boxEl.clientWidth; // carré
      const iw = cropImg.naturalWidth || (cropImg as any).width || 1;
      const ih = cropImg.naturalHeight || (cropImg as any).height || 1;

      const base = computeCoverScale(iw, ih, box);
      const s = base * cropZoom;
      const dw = iw * s;
      const dh = ih * s;

      const dx = (box - dw) / 2 + cropTx;
      const dy = (box - dh) / 2 + cropTy;

      // Render final 400x400
      const out = document.createElement("canvas");
      out.width = 400;
      out.height = 400;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("NO_CANVAS_CTX");

      // Map from UI box coords -> output coords
      const ratio = 400 / box;
      ctx.drawImage(cropImg, dx * ratio, dy * ratio, dw * ratio, dh * ratio);

      const blob: Blob = await new Promise((resolve, reject) => {
        out.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("TOBLOB_FAILED"))),
          "image/jpeg",
          0.88
        );
      });

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
      setCamErr("Upload échoué");
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

    // refresh TTL
    localStorage.setItem(JOIN_CODE_AT_KEY, String(Date.now()));

    const c = new LobbyClient();
    clientRef.current = c;

    c.onState = (s) => {
      setSt(s);
      setErr("");
    };

    c.onError = (_code, message) => {
      // on reste sur /wait, mais si serveur dit fermé/introuvable, on repasse sur /play
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

        // ping immédiat pour vérifier la session
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

    const name = nameDraft; // tous caractères autorisés
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
    } catch {
      // même si release échoue, on clear local + retour choose
    }

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
        {/* Top back button (changer de player) */}
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

            {camStep === "live" ? (
              <>
                <div className={styles.videoWrap}>
                  <video ref={videoRef} className={styles.video} playsInline muted />
                  <div className={styles.cropGuide} />
                </div>

                <div className={styles.modalRow}>
                  <button className={styles.btn} disabled={camBusy} onClick={captureAndGoCrop}>
                    Capturer
                  </button>
                  <button className={styles.btnDanger} disabled={camBusy} onClick={closeCamera}>
                    Annuler
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  ref={cropBoxRef}
                  className={styles.cropBox}
                  onPointerDown={onCropPointerDown}
                  onPointerMove={onCropPointerMove}
                  onPointerUp={onCropPointerUp}
                  onPointerCancel={onCropPointerUp}
                >
                  {cropImg ? (
                    <img
                      className={styles.cropImg}
                      src={cropImg.src}
                      alt=""
                      draggable={false}
                      style={{
                        transform: (() => {
                          const box = cropBoxRef.current?.clientWidth || 1;
                          const iw = cropImg.naturalWidth || 1;
                          const ih = cropImg.naturalHeight || 1;
                          const base = computeCoverScale(iw, ih, box);
                          const s = base * cropZoom;
                          return `translate(${cropTx}px, ${cropTy}px) scale(${s})`;
                        })(),
                      }}
                    />
                  ) : null}
                  <div className={styles.cropFrame} />
                </div>

                <div className={styles.zoomRow}>
                  <div className={styles.zoomLabel}>Zoom</div>
                  <input
                    className={styles.zoom}
                    type="range"
                    min={1}
                    max={3}
                    step={0.01}
                    value={cropZoom}
                    onChange={(e) => onZoomChange(Number(e.target.value))}
                    disabled={camBusy}
                  />
                </div>

                <div className={styles.modalRow}>
                  <button className={styles.btn} disabled={camBusy} onClick={uploadCroppedPhoto}>
                    Valider
                  </button>
                  <button
                    className={styles.btn}
                    disabled={camBusy}
                    onClick={() => {
                      // revenir à live pour refaire une photo
                      setCamStep("live");
                      setCropImg(null);
                      setCropTx(0);
                      setCropTy(0);
                      setCropZoom(1);
                      openCamera().catch(() => {});
                    }}
                  >
                    Reprendre
                  </button>
                  <button className={styles.btnDanger} disabled={camBusy} onClick={closeCamera}>
                    Annuler
                  </button>
                </div>
              </>
            )}

            {camBusy ? <div className={styles.photoHint}>Traitement…</div> : null}
            {camStep === "crop" ? (
              <div className={styles.photoHint}>Déplace l’image et ajuste le zoom, puis Valider.</div>
            ) : (
              <div className={styles.photoHint}>Caméra uniquement.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
