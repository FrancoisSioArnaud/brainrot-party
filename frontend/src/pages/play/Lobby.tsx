import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { StateSyncRes, PlayerVisible } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearPlaySession, loadPlaySession } from "../../lib/storage";

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

function IconEdit({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCamera({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2v11Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default function PlayLobby() {
  const nav = useNavigate();
  const session = useMemo(() => loadPlaySession(), []);
  const [status, setStatus] = useState("disconnected");
  const [err, setErr] = useState("");
  const [state, setState] = useState<ViewState | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [rename, setRename] = useState("");
  const [renameErr, setRenameErr] = useState("");

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
    if (!session?.room_code || !session?.device_id) {
      nav("/play", { replace: true });
      return;
    }
  }, [session?.room_code, session?.device_id, nav]);

  useEffect(() => {
    return () => {
      clientRef.current?.close();
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state) return;
    if (state.phase === "game" || state.phase === "game_over") nav("/play/game", { replace: true });
  }, [state?.phase, nav]);

  useEffect(() => {
    if (didAutoConnectRef.current) return;
    if (!session?.room_code || !session?.device_id) return;

    didAutoConnectRef.current = true;
    connect(session.room_code, session.device_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.room_code, session?.device_id]);

  function stopCamera() {
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
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
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraErr("Caméra non supportée par ce navigateur.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 720 },
          height: { ideal: 720 },
        },
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

  async function openCamera() {
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

    setCameraErr("");
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
        nav("/play", { replace: true });
        return;
      }

      setErr(`${code}${msg ? `: ${msg}` : ""}`);
      return;
    }

    if (m.type === "SLOT_INVALIDATED") {
      setErr(
        m.payload.reason === "reset_by_master"
          ? "Slots reset par le master. Re-choisis un joueur."
          : "Ton slot a été invalidé. Re-choisis un joueur."
      );
      setEditingName(false);
      setRename("");
      setRenameErr("");
      setLastTakeFail(null);
      setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
      return;
    }

    if (m.type === "TAKE_PLAYER_FAIL") {
      const r = m.payload.reason;
      setLastTakeFail(r === "taken_now" ? "taken_now" : (r as any));
      if (r === "setup_not_ready") setErr("Le master n’a pas encore publié le setup. Réessaie dans quelques secondes.");
      else if (r === "device_already_has_player") setErr("Tu as déjà un joueur sur ce device.");
      else if (r === "inactive") setErr("Ce joueur est désactivé.");
      else if (r === "player_not_found") setErr("Joueur introuvable.");
      else setErr("Slot déjà pris.");
      return;
    }

    if (m.type === "TAKE_PLAYER_OK") {
      setErr("");
      setLastTakeFail(null);
      setState((prev) => (prev ? { ...prev, my_player_id: m.payload.my_player_id } : prev));
      return;
    }

    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setLastTakeFail(null);
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

  function connect(room_code: string, device_id: string) {
    setErr("");
    setLastTakeFail(null);
    setEditingName(false);
    setRenameErr("");

    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    setStatus("connecting");

    c.connectJoinRoom(
      { room_code, device_id },
      {
        onOpen: () => setStatus("open"),
        onClose: () => setStatus("closed"),
        onError: () => {
          setStatus("error");
          setErr("Connexion impossible.");
        },
        onMessage: (m) => onMsg(m),
      }
    );
  }

  function resetAndBackToEnter() {
    clientRef.current?.close();
    stopCamera();
    setStatus("disconnected");
    setState(null);
    setErr("");
    setEditingName(false);
    setRename("");
    setRenameErr("");
    setLastTakeFail(null);
    clearPlaySession();
    nav("/play", { replace: true });
  }

  function backToEnterKeepSession() {
    clientRef.current?.close();
    stopCamera();
    nav("/play", { replace: true });
  }

  function takePlayer(player_id: string) {
    setErr("");
    setLastTakeFail(null);
    clientRef.current?.send({ type: "TAKE_PLAYER", payload: { player_id } });
  }

  function releasePlayer() {
    setErr("");
    setLastTakeFail(null);
    setEditingName(false);
    setRename("");
    setRenameErr("");
    setState((prev) => (prev ? { ...prev, my_player_id: null } : prev));
    clientRef.current?.send({ type: "RELEASE_PLAYER", payload: {} });
  }

  function submitRename() {
    setErr("");
    setRenameErr("");

    const name = normalizeName(rename);
    if (!name) {
      setRenameErr("Nom requis");
      return;
    }
    if (name.length > 24) {
      setRenameErr("24 caractères max");
      return;
    }

    clientRef.current?.send({ type: "RENAME_PLAYER", payload: { new_name: name } });
    setEditingName(false);
  }

  const my: PlayerVisible | null =
    state && state.my_player_id ? state.players.find((p) => p.player_id === state.my_player_id) ?? null : null;

  const playersInServerOrder = state?.players ?? [];
  const hasInvalidMyPlayer = !!state?.my_player_id && !my;
  const square = clamp(Math.min(window.innerWidth - 48, 360), 240, 360);

  return (
    <div className="card">
      <div className="h1">Play — Lobby</div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn" onClick={backToEnterKeepSession}>
          ← Code
        </button>
        <button className="btn" onClick={resetAndBackToEnter}>
          RESET
        </button>
        <span className="badge ok">WS: {status}</span>
        {session?.room_code ? (
          <span className="badge ok">
            room: <span className="mono">{session.room_code}</span>
          </span>
        ) : null}
      </div>

      {err ? (
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)", marginTop: 12 }}>
          {err}
          {lastTakeFail === "device_already_has_player" ? (
            <div className="row" style={{ marginTop: 10, gap: 10 }}>
              <button
                className="btn"
                onClick={() => clientRef.current?.send({ type: "REQUEST_SYNC", payload: {} })}
                disabled={status !== "open"}
              >
                Voir mon joueur
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ height: 12 }} />

      {!state ? (
        <div className="small">Connexion au lobby…</div>
      ) : state.phase !== "lobby" ? (
        <div className="card">
          <div className="h2">Partie en cours</div>
          <div className="small">Redirection…</div>
        </div>
      ) : !state.setup_ready ? (
        <div className="card">
          <div className="h2">En attente du setup</div>
          <div className="small">Le master prépare la partie.</div>
        </div>
      ) : !state.my_player_id ? (
        <div className="card">
          <div className="h2">Choisir un joueur</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              marginTop: 10,
            }}
          >
            {playersInServerOrder.map((p) => {
              const canTake = p.active && p.status === "free";
              return (
                <button
                  key={p.player_id}
                  className="btn"
                  onClick={() => (canTake ? takePlayer(p.player_id) : null)}
                  disabled={!canTake}
                  style={{
                    minHeight: 86,
                    padding: 12,
                    borderRadius: 12,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 10,
                    textAlign: "left",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center", width: "100%" }}>
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 999,
                        overflow: "hidden",
                        background: "rgba(255,255,255,0.06)",
                        flex: "0 0 auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span className="mono" style={{ fontSize: 14, opacity: 0.85 }}>
                          {p.name
                            .split(" ")
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((x) => x[0]?.toUpperCase())
                            .join("") || "?"}
                        </span>
                      )}
                    </div>

                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <div className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name}
                      </div>
                      <div className="small" style={{ opacity: 0.8 }}>
                        {p.status === "free" ? "Libre" : p.status === "taken" ? "Pris" : "Désactivé"}
                      </div>
                    </div>

                    <span className={p.status === "free" ? "badge ok" : "badge warn"} style={{ flex: "0 0 auto" }}>
                      {p.status}
                    </span>
                  </div>

                  <div className="small mono" style={{ opacity: 0.75 }}>
                    {canTake ? "Tap pour prendre" : "Indisponible"}
                  </div>
                </button>
              );
            })}
          </div>
          {playersInServerOrder.length === 0 ? <div className="small">Aucun joueur disponible.</div> : null}
        </div>
      ) : (
        <div className="card">
          <button className="btn" onClick={releasePlayer} disabled={status !== "open"}>
            ← Retour
          </button>

          <div style={{ height: 12 }} />

          <div className="h2">Mon joueur</div>

          {hasInvalidMyPlayer ? (
            <div className="card" style={{ borderColor: "rgba(255,180,0,0.45)", marginTop: 10 }}>
              <div className="small">Ton slot n’existe plus. Re-choisis un joueur.</div>
            </div>
          ) : my ? (
            <div style={{ marginTop: 12, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 999,
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.06)",
                  position: "relative",
                  flex: "0 0 auto",
                }}
              >
                {my.avatar_url ? (
                  <img src={my.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: 0.85,
                    }}
                  >
                    <span className="mono" style={{ fontSize: 22 }}>
                      {my.name
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((x) => x[0]?.toUpperCase())
                        .join("") || "?"}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ minWidth: 220 }}>
                {!editingName ? (
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div className="mono" style={{ fontSize: 18 }}>
                        {my.name}
                      </div>
                      <div className="small mono">{my.player_id}</div>
                    </div>

                    <button
                      className="btn"
                      onClick={() => {
                        setRename(my.name);
                        setRenameErr("");
                        setEditingName(true);
                      }}
                      disabled={status !== "open"}
                      title="Renommer"
                    >
                      <IconEdit />
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="row">
                      <input
                        className="input"
                        value={rename}
                        onChange={(e) => setRename(e.target.value)}
                        placeholder="Nouveau nom"
                        style={{ width: 220 }}
                      />
                      <button className="btn" onClick={submitRename} disabled={status !== "open"}>
                        OK
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          setEditingName(false);
                          setRenameErr("");
                        }}
                      >
                        Annuler
                      </button>
                    </div>
                    {renameErr ? (
                      <div className="small" style={{ marginTop: 8, color: "rgba(255,120,120,0.95)" }}>
                        {renameErr}
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="row" style={{ marginTop: 10, gap: 10 }}>
                  <button className="btn" onClick={openCamera} disabled={status !== "open"}>
                    <IconCamera /> Photo
                  </button>
                  <button
                    className="btn"
                    onClick={() => clientRef.current?.send({ type: "DELETE_AVATAR", payload: {} })}
                    disabled={status !== "open"}
                  >
                    Suppr. photo
                  </button>
                </div>
              </div>

              {cameraOpen ? (
                <div className="card" style={{ marginTop: 12, width: "100%" }}>
                  <div className="h2">Caméra</div>

                  {cameraErr ? (
                    <div className="small" style={{ marginTop: 8, color: "rgba(255,120,120,0.95)" }}>
                      {cameraErr}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12, width: square, maxWidth: "100%" }}>
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      style={{ width: "100%", height: "auto", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}
                    />
                  </div>

                  <div className="row" style={{ marginTop: 12, gap: 10 }}>
                    <button className="btn" onClick={takePhotoAndUpload} disabled={cameraBusy || status !== "open"}>
                      Prendre
                    </button>
                    <button className="btn" onClick={closeCamera}>
                      Fermer
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
