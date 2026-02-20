import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlayStore } from "../../store/playStore";
import { PlayLobbyClient } from "../../ws/playLobbyClient";
import { squareResize400 } from "../../utils/imageSquare400";

type LobbyPlayerLite = {
  id: string;
  name: string;
  active: boolean;
  status: "free" | "connected" | "afk" | "disabled";
  photo_url?: string | null;
};

export default function PlayWait() {
  const nav = useNavigate();

  const join_code = usePlayStore(s => s.join_code);
  const device_id = usePlayStore(s => s.device_id);
  const player_id = usePlayStore(s => s.player_id);
  const token = usePlayStore(s => s.player_session_token);

  const clearClaim = usePlayStore(s => s.clearClaim);
  const setKicked = usePlayStore(s => s.setKicked);
  const setLobbyClosed = usePlayStore(s => s.setLobbyClosed);

  const [players, setPlayers] = useState<LobbyPlayerLite[]>([]);
  const [myName, setMyName] = useState("");
  const [status, setStatus] = useState<string>("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [errPhoto, setErrPhoto] = useState<string>("");

  const clientRef = useRef<PlayLobbyClient | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!join_code) { nav("/play", { replace: true }); return; }
    if (!player_id || !token) { nav("/play/choose", { replace: true }); return; }

    const c = new PlayLobbyClient();
    clientRef.current = c;

    c.onLobbyState = (payload) => {
      const list = (payload.players || []) as LobbyPlayerLite[];
      setPlayers(list);
    };

    c.onKicked = (payload) => {
      setKicked(payload?.message || "Tu as été kick");
      clearClaim();
      nav("/play", { replace: true });
    };

    c.onClosed = (payload) => {
      setLobbyClosed(payload?.reason || "unknown");
      clearClaim();
      nav("/play", { replace: true });
    };

    (async () => {
      try {
        await c.connect(join_code);
        c.hello(device_id);
      } catch {
        clearClaim();
        nav("/play", { replace: true });
      }
    })();

    return () => c.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join_code, device_id, player_id, token]);

  const me = useMemo(() => players.find(p => p.id === player_id), [players, player_id]);

  useEffect(() => {
    if (!me) return;
    setMyName(me.name || "");
    setStatus(me.status);
    setPhotoUrl(me.photo_url || null);
  }, [me?.name, me?.status, me?.photo_url]);

  // Ping loop (toutes les 5s)
  useEffect(() => {
    if (!join_code || !player_id || !token) return;
    const id = setInterval(() => {
      clientRef.current?.ping(device_id, player_id, token);
    }, 5000);
    return () => clearInterval(id);
  }, [join_code, device_id, player_id, token]);

  async function uploadPhoto(file: File) {
    if (!join_code || !player_id || !token) return;

    setBusyPhoto(true);
    setErrPhoto("");

    try {
      const blob = await squareResize400(file);
      const fd = new FormData();
      fd.append("photo", blob, "photo.jpg");

      const res = await fetch(`/lobby/${join_code}/players/${player_id}/photo`, {
        method: "POST",
        headers: {
          "x-device-id": device_id,
          "x-player-token": token
        },
        body: fd
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setErrPhoto(data?.error || "Upload impossible");
        return;
      }

      // instant local preview (Master recevra via lobby_state au prochain tick / message)
      if (data.temp_photo_url) setPhotoUrl(data.temp_photo_url);
    } catch {
      setErrPhoto("Upload impossible");
    } finally {
      setBusyPhoto(false);
    }
  }

  return (
    <div style={{ padding: 18, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Connecté</h1>
      <div style={{ color: "var(--muted)", fontWeight: 800, marginBottom: 10 }}>
        Le jeu va bientôt commencer.
      </div>

      <div style={{ padding: 14, borderRadius: 16, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.04)",
              overflow: "hidden",
              flex: "0 0 auto"
            }}
          >
            {photoUrl ? (
              <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : null}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 1000, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis" }}>
              {myName || "—"}
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
              fontWeight: 1000
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

        {errPhoto && (
          <div style={{ marginTop: 10, color: "var(--muted)", fontWeight: 800 }}>
            {errPhoto}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <label style={{ color: "var(--muted)", fontWeight: 800 }}>Modifier mon nom</label>
        <input
          value={myName}
          onChange={(e) => setMyName(e.target.value)}
          style={{
            padding: "12px 12px",
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text)",
            fontWeight: 900
          }}
        />
        <button
          style={{
            padding: "12px 12px",
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.08)",
            color: "var(--text)",
            fontWeight: 1000
          }}
          onClick={() => {
            clientRef.current?.setName(device_id, player_id!, token!, myName.trim());
          }}
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
            fontWeight: 1000
          }}
          onClick={() => {
            clientRef.current?.releasePlayer(device_id, player_id!, token!);
            clearClaim();
            nav("/play/choose");
          }}
        >
          Changer de player
        </button>
      </div>
    </div>
  );
}
