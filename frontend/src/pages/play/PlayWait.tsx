import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlayStore } from "../../store/playStore";
import { PlayLobbyClient } from "../../ws/playLobbyClient";

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

  const clientRef = useRef<PlayLobbyClient | null>(null);

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
  }, [me?.name, me?.status]);

  // Ping loop (toutes les 5s)
  useEffect(() => {
    if (!join_code || !player_id || !token) return;
    const id = setInterval(() => {
      clientRef.current?.ping(device_id, player_id, token);
    }, 5000);
    return () => clearInterval(id);
  }, [join_code, device_id, player_id, token]);

  return (
    <div style={{ padding: 18, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Connecté</h1>
      <div style={{ color: "var(--muted)", fontWeight: 800, marginBottom: 10 }}>
        Le jeu va bientôt commencer.
      </div>

      <div style={{ padding: 14, borderRadius: 16, border: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 1000, fontSize: 18 }}>{myName || "—"}</div>
        <div style={{ color: "var(--muted)", fontWeight: 800, marginTop: 6 }}>
          Statut: {status === "connected" ? "Connecté" : status === "afk" ? "AFK" : status}
        </div>
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
            clientRef.current?.setName(device_id, player_id, token, myName.trim());
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
          onClick={async () => {
            clientRef.current?.releasePlayer(device_id, player_id, token);
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
