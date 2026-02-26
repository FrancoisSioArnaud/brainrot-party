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

function computeCoverCrop(srcW: number, srcH: number, dstW: number, dstH: number) {
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

  const [editing, setEditing] = useState(false);
  const [rename, setRename] = useState("");

  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const clientRef = useRef<BrpWsClient | null>(null);

  useEffect(() => {
    return () => {
      clientRef.current?.close();
      stopCamera();
    };
  }, []);

  function stopCamera() {
    const s = streamRef.current;
    if (s) s.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      // @ts-ignore
      videoRef.current.srcObject = null;
    }
  }

  async function startCamera() {
    stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" } },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      // @ts-ignore
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
  }

  async function openCamera() {
    setCameraOpen(true);
    setTimeout(startCamera, 0);
  }

  function closeCamera() {
    stopCamera();
    setCameraOpen(false);
  }

  async function takePhotoAndUpload() {
    if (!videoRef.current) return;
    const jpeg = await captureSquareJpeg300(videoRef.current);
    clientRef.current?.send({ type: "UPDATE_AVATAR", payload: { image: jpeg } });
    closeCamera();
  }

  function connect() {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;

    savePlaySession({ room_code: code, device_id: deviceId });

    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    setStatus("connecting");

    c.connectJoinRoom(
      { room_code: code, device_id: deviceId },
      {
        onOpen: () => setStatus("open"),
        onClose: () => setStatus("closed"),
        onError: () => setStatus("error"),
        onMessage: (m) => {
          if (m.type === "STATE_SYNC_RESPONSE") {
            const p = m.payload as StateSyncRes;
            setState({
              room_code: p.room_code,
              phase: p.phase,
              setup_ready: p.setup_ready,
              players: p.players_visible,
              my_player_id: p.my_player_id,
            });
          }
        },
      }
    );
  }

  function releasePlayer() {
    clientRef.current?.send({ type: "RELEASE_PLAYER", payload: {} });
    setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
  }

  function takePlayer(player_id: string) {
    clientRef.current?.send({ type: "TAKE_PLAYER", payload: { player_id } });
  }

  function submitRename() {
    const name = normalizeName(rename);
    if (!name) return;
    clientRef.current?.send({ type: "RENAME_PLAYER", payload: { new_name: name } });
    setEditing(false);
  }

  const my = state?.my_player_id
    ? state.players.find((p) => p.player_id === state.my_player_id)
    : null;

  const square = clamp(Math.min(window.innerWidth - 48, 360), 240, 360);

  return (
    <div className="card">
      <div className="h1">Play</div>

      {!state || !state.my_player_id ? (
        <div className="card">
          <div className="h2">Choisir un joueur</div>
          <div className="list">
            {state?.players.map((p) => (
              <div className="item" key={p.player_id}>
                <div className="mono">{p.name}</div>
                <button
                  className="btn"
                  onClick={() => takePlayer(p.player_id)}
                  disabled={p.status !== "free"}
                >
                  {p.status === "free" ? "Prendre" : "Pris"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="btn" onClick={releasePlayer}>
              ← Retour
            </button>
          </div>

          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
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
              {my?.avatar_url && (
                <img
                  src={my.avatar_url}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  bottom: 6,
                  right: 6,
                  background: "rgba(0,0,0,0.7)",
                  borderRadius: 999,
                  padding: 4,
                  fontSize: 12,
                }}
              >
                📷
              </div>
            </div>

            <div>
              {editing ? (
                <input
                  className="input"
                  value={rename}
                  autoFocus
                  maxLength={24}
                  onChange={(e) => setRename(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitRename();
                  }}
                />
              ) : (
                <div
                  className="mono"
                  style={{ fontSize: 18, cursor: "pointer", display: "flex", gap: 6 }}
                  onClick={() => {
                    setRename(my?.name ?? "");
                    setEditing(true);
                  }}
                >
                  {my?.name}
                  <span>✏️</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {cameraOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.9)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: square, height: square, objectFit: "cover" }}
          />
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={takePhotoAndUpload}>
              Prendre la photo
            </button>
            <button className="btn" onClick={closeCamera}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
