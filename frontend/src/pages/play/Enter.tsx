import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearPlaySession, ensureDeviceId, loadPlaySession, savePlaySession } from "../../lib/storage";

type ViewState = {
  room_code: string;
  phase: string;
  setup_ready: boolean;
  players: PlayerVisible[];
  my_player_id: string | null;
};

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function computeCoverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): { sx: number; sy: number; sw: number; sh: number } {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;

  if (srcRatio > dstRatio) {
    const newW = srcH * dstRatio;
    const sx = Math.floor((srcW - newW) / 2);
    return { sx, sy: 0, sw: Math.floor(newW), sh: srcH };
  } else {
    const newH = srcW / dstRatio;
    const sy = Math.floor((srcH - newH) / 2);
    return { sx: 0, sy, sw: srcW, sh: Math.floor(newH) };
  }
}

async function captureSquareJpeg300(videoEl: HTMLVideoElement): Promise<string> {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) throw new Error("video_not_ready");

  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 300;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_ctx_failed");

  const { sx, sy, sw, sh } = computeCoverCrop(vw, vh, 300, 300);
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, 300, 300);

  return canvas.toDataURL("image/jpeg", 0.85);
}

export default function PlayEnter() {
  const existing = useMemo(() => loadPlaySession(), []);
  const [roomCode, setRoomCode] = useState(existing?.room_code ?? "");
  const [deviceId, setDeviceId] = useState(ensureDeviceId(existing?.device_id ?? null));

  const [status, setStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ViewState | null>(null);

  const [rename, setRename] = useState("");
  const [renameErr, setRenameErr] = useState("");
  const [editingName, setEditingName] = useState(false);

  const [lastTakeFail, setLastTakeFail] = useState<
    null | "setup_not_ready" | "device_already_has_player" | "inactive" | "player_not_found" | "taken_now"
  >(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraErr, setCameraErr] = useState("");
  const [cameraBusy, setCameraBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const clientRef = useRef<BrpWsClient | null>(null);
  const didAutoConnectRef = useRef(false);

  useEffect(() => {
    return () => {
      clientRef.current?.close();
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (didAutoConnectRef.current) return;
    if (!existing?.room_code || !existing?.device_id) return;

    didAutoConnectRef.current = true;

    setRoomCode(existing.room_code);
    setDeviceId(existing.device_id);

    setTimeout(() => connect(existing.room_code, existing.device_id), 0);
  }, []);

  function stopCamera() {
    const s = streamRef.current;
    if (s) for (const t of s.getTracks()) t.stop();
    streamRef.current = null;
    if (videoRef.current) {
      // @ts-ignore
      videoRef.current.srcObject = null;
    }
  }

  async function startCamera() {
    setCameraErr("");
    setCameraBusy(true);
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" }, width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });

      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;

      // @ts-ignore
      v.srcObject = stream;
      await v.play();
    } catch {
      setCameraErr("Accès caméra refusé ou impossible.");
    } finally {
      setCameraBusy(false);
    }
  }

  function openCamera() {
    setCameraErr("");
    setCameraOpen(true);
    setTimeout(() => startCamera(), 0);
  }

  function closeCamera() {
    stopCamera();
    setCameraOpen(false);
    setCameraErr("");
    setCameraBusy(false);
  }

  async function takePhotoAndUpload() {
    if (status !== "open") return;
    const v = videoRef.current;
    if (!v) return;

    setCameraBusy(true);
    try {
      const jpeg = await captureSquareJpeg300(v);
      clientRef.current?.send({ type: "UPDATE_AVATAR", payload: { image: jpeg } });
      closeCamera();
    } catch {
      setCameraErr("Impossible de prendre la photo.");
      setCameraBusy(false);
    }
  }

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      const code = m.payload.error;
      const msg = String(m.payload.message ?? "");

      if (code === "room_expired" || code === "room_not_found") {
        clientRef.current?.close();
        clearPlaySession();
        setState(null);
        setStatus("disconnected");
        setErr(code === "room_expired" ? "Room expiré." : "Room introuvable.");
        return;
      }

      setErr(`${code}${msg ? `: ${msg}` : ""}`);
      return;
    }

    if (m.type === "SLOT_INVALIDATED") {
      setErr("Ton slot a été invalidé. Re-choisis un joueur.");
      setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
      return;
    }

    if (m.type === "TAKE_PLAYER_FAIL") {
      setErr("Slot déjà pris.");
      return;
    }

    if (m.type === "TAKE_PLAYER_OK") {
      setErr("");
      setState((prev) => (prev ? { ...prev, my_player_id: m.payload.my_player_id } : prev));
      return;
    }

    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setState({
        room_code: p.room_code,
        phase: p.phase,
        setup_ready: p.setup_ready,
        players: p.players_visible,
        my_player_id: p.my_player_id,
      });
      return;
    }
  }

  function connect(codeOverride?: string, deviceOverride?: string) {
    setErr("");

    const code = (codeOverride ?? roomCode).trim().toUpperCase();
    if (!code) {
      setErr("Entre un code.");
      return;
    }

    const prev = loadPlaySession();
    let joinDeviceId = deviceOverride ?? deviceId;

    if (prev?.room_code && prev.room_code !== code) {
      clearPlaySession();
      joinDeviceId = ensureDeviceId(null);
      setDeviceId(joinDeviceId);
      setState(null);
    }

    savePlaySession({ room_code: code, device_id: joinDeviceId });

    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    setStatus("connecting");

    c.connectJoinRoom(
      { room_code: code, device_id: joinDeviceId },
      {
        onOpen: () => setStatus("open"),
        onClose: () => setStatus("closed"),
        onError: () => setErr("Connexion impossible."),
        onMessage: (m) => onMsg(m),
      }
    );
  }

  function releasePlayer() {
    setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
    clientRef.current?.send({ type: "RELEASE_PLAYER", payload: {} });
  }

  function submitRename() {
    const name = normalizeName(rename);
    if (!name) return;
    clientRef.current?.send({ type: "RENAME_PLAYER", payload: { new_name: name } });
    setEditingName(false);
  }

  const my = state?.my_player_id ? state.players.find((p) => p.player_id === state.my_player_id) ?? null : null;
  const playersInServerOrder = state?.players ?? [];
  const square = clamp(Math.min(window.innerWidth - 48, 360), 240, 360);

  return (
    <div className="card">
      <div className="h1">Play</div>

      {!state?.my_player_id ? (
        <div className="card">
          <div className="h2">Choisir un joueur</div>
          <div className="list">
            {playersInServerOrder.map((p) => (
              <div className="item" key={p.player_id}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 999,
                      overflow: "hidden",
                      background: "rgba(255,255,255,0.06)",
                    }}
                  >
                    {p.avatar_url ? (
                      <img src={p.avatar_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : null}
                  </div>
                  <span className="mono">{p.name}</span>
                </div>
                <button className="btn" onClick={() => clientRef.current?.send({ type: "TAKE_PLAYER", payload: { player_id: p.player_id } })}>
                  {p.status === "free" ? "Prendre" : "Pris"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card">
          <button className="btn" onClick={releasePlayer}>← Retour</button>

          <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 16 }}>
            <div
              onClick={openCamera}
              style={{
                width: 72,
                height: 72,
                borderRadius: 999,
                overflow: "hidden",
                position: "relative",
                cursor: "pointer",
                background: "rgba(255,255,255,0.06)",
              }}
            >
              {my?.avatar_url ? (
                <img src={my.avatar_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : null}
              <div
                style={{
                  position: "absolute",
                  bottom: 4,
                  right: 4,
                  background: "rgba(0,0,0,0.6)",
                  borderRadius: 999,
                  padding: 4,
                  fontSize: 12,
                }}
              >
                📷
              </div>
            </div>

            <div>
              {editingName ? (
                <input
                  className="input"
                  value={rename}
                  autoFocus
                  onChange={(e) => setRename(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={(e) => e.key === "Enter" && submitRename()}
                />
              ) : (
                <div
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                  onClick={() => {
                    setRename(my?.name ?? "");
                    setEditingName(true);
                  }}
                >
                  <span className="mono" style={{ fontSize: 18 }}>{my?.name}</span>
                  <span>✏️</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {cameraOpen && (
        <div style={{ position: "fixed", inset: 0, background: "black", display: "flex", flexDirection: "column", alignItems: "center", padding: 20 }}>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: square, height: square, objectFit: "cover", transform: "scaleX(-1)" }}
          />
          <button className="btn" onClick={takePhotoAndUpload}>Prendre la photo</button>
          <button className="btn" onClick={closeCamera}>Fermer</button>
        </div>
      )}
    </div>
  );
}
