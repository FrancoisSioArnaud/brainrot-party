import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import styles from "./Wait.module.css";
import { getOrCreateDeviceId } from "../../utils/ids";
import { PlayLobbyClient, LobbyPlayerLite } from "../../ws/playLobbyClient";
import { clearPlaySession, getPlaySession, setOneShotError } from "../../utils/playSession";
import { squareResize400 } from "../../utils/imageSquare400";

export default function PlayWait() {
  const { joinCode } = useParams();
  const nav = useNavigate();
  const device_id = getOrCreateDeviceId();

  const session = useMemo(() => getPlaySession(), []);
  const player_id = session?.player_id || null;
  const token = session?.player_token || null;

  const clientRef = useRef<PlayLobbyClient | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [players, setPlayers] = useState<LobbyPlayerLite[]>([]);
  const [name, setName] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("connected");

  const [busyPhoto, setBusyPhoto] = useState(false);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    if (!joinCode || !player_id || !token) {
      setOneShotError("Sélectionne un player");
      nav("/play", { replace: true });
      return;
    }

    const c = new PlayLobbyClient();
    clientRef.current = c;

    c.onLobbyState = (payload) => setPlayers((payload.players || []) as LobbyPlayerLite[]);

    c.onClosed = () => {
      clearPlaySession();
      setOneShotError("Partie démarrée / room fermée");
      nav("/play", { replace: true });
    };

    c.onGameCreated = ({ room_code }) => {
      nav(`/play/game/${encodeURIComponent(room_code)}`, { replace: true });
    };

    c.onKicked = ({ reason }) => {
      clearPlaySession();
      const msg =
        reason === "deleted"
          ? "Ton player a été supprimé"
          : reason === "disabled"
          ? "Ton player a été désactivé"
          : "Tu as été déconnecté";
      setOneShotError(msg);
      nav(`/play/choose/${encodeURIComponent(String(joinCode))}`, { replace: true });
    };

    c.onError = (p) => {
      if (p?.code === "TOKEN_INVALID") {
        clearPlaySession();
        setOneShotError("Session expirée. Rejoins la room.");
        nav("/play", { replace: true });
        return;
      }
      setErr(p?.message || "Erreur");
    };

    (async () => {
      try {
        await c.connect(String(joinCode));
        c.hello(device_id);
      } catch {
        clearPlaySession();
        setOneShotError("Room introuvable");
        nav("/play", { replace: true });
      }
    })();

    return () => c.disconnect();
  }, [joinCode, player_id, token, nav, device_id]);

  const me = useMemo(() => players.find((p) => p.id === player_id), [players, player_id]);

  useEffect(() => {
    if (!me) return;
    setName(me.name || "");
    setPhotoUrl((me.photo_url as any) || null);
    setStatus(me.status);
  }, [me?.name, me?.photo_url, me?.status]);

  useEffect(() => {
    if (!joinCode || !player_id || !token) return;
    const id = setInterval(() => clientRef.current?.ping(device_id, player_id, token), 5000);
    return () => clearInterval(id);
  }, [joinCode, player_id, token, device_id]);

  async function uploadPhoto(file: File) {
    if (!joinCode || !player_id || !token) return;

    setBusyPhoto(true);
    setErr("");

    try {
      const blob = await squareResize400(file);
      const fd = new FormData();
      fd.append("photo", blob, "photo.jpg");

      const res = await fetch(`/lobby/${joinCode}/players/${player_id}/photo`, {
        method: "POST",
        headers: { "x-device-id": device_id, "x-player-token": token },
        body: fd,
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error || "Upload impossible");
        return;
      }
      if (data.temp_photo_url) setPhotoUrl(data.temp_photo_url);
    } catch {
      setErr("Upload impossible");
    } finally {
      setBusyPhoto(false);
    }
  }

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Connecté</h1>
      <div className={styles.text}>Le jeu va bientôt commencer.</div>

      <div style={{ marginTop: 12, padding: 14, borderRadius: 16, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.04)",
              overflow: "hidden",
              flex: "0 0 auto",
            }}
          >
            {photoUrl ? <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 1000, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis" }}>
              {name || "—"}
            </div>
            <div style={{ color: "var(--muted)", fontWeight: 800, marginTop: 6 }}>
              Statut: {status === "connected" ? "Connecté" : status === "afk" ? "AFK" : status}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            disabled={busyPhoto}
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.08)",
              color: "var(--text)",
              fontWeight: 1000,
            }}
            onClick={() => fileRef.current?.click()}
          >
            {busyPhoto ? "Upload…" : "Ajouter ma photo"}
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.currentTarget.value = "";
              if (!f) return;
              await uploadPhoto(f);
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <label style={{ color: "var(--muted)", fontWeight: 800 }}>Modifier mon nom</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            padding: "12px 12px",
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text)",
            fontWeight: 900,
          }}
        />

        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={{
              flex: 1,
              padding: "12px 12px",
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.08)",
              color: "var(--text)",
              fontWeight: 1000,
            }}
            onClick={() => clientRef.current?.setName(device_id, player_id!, token!, name.trim())}
          >
            Sauvegarder
          </button>

          <button
            style={{
              padding: "12px 12px",
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text)",
              fontWeight: 1000,
            }}
            onClick={() => clientRef.current?.resetName(device_id, player_id!, token!)}
          >
            Reset nom
          </button>
        </div>

        <button
          style={{
            padding: "12px 12px",
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text)",
            fontWeight: 1000,
          }}
          onClick={() => {
            clientRef.current?.releasePlayer(device_id, player_id!, token!);
            clearPlaySession();
            nav(`/play/choose/${encodeURIComponent(String(joinCode))}`, { replace: true });
          }}
        >
          Changer de player
        </button>

        {err ? (
          <div style={{ marginTop: 6, padding: 12, borderRadius: 14, border: "1px solid var(--border)" }}>
            {err}
          </div>
        ) : null}
      </div>
    </div>
  );
}
