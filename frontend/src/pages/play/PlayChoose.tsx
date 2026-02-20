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
  afk_seconds_left?: number | null;
};

export default function PlayChoose() {
  const nav = useNavigate();
  const join_code = usePlayStore(s => s.join_code);
  const device_id = usePlayStore(s => s.device_id);
  const setClaim = usePlayStore(s => s.setClaim);
  const setKicked = usePlayStore(s => s.setKicked);
  const setLobbyClosed = usePlayStore(s => s.setLobbyClosed);

  const [players, setPlayers] = useState<LobbyPlayerLite[]>([]);
  const [error, setError] = useState<string>("");

  const clientRef = useRef<PlayLobbyClient | null>(null);

  useEffect(() => {
    if (!join_code) {
      nav("/play", { replace: true });
      return;
    }

    const c = new PlayLobbyClient();
    clientRef.current = c;

    c.onLobbyState = (payload) => {
      const list = (payload.players || []) as LobbyPlayerLite[];
      setPlayers(list);
      setError("");
    };

    c.onKicked = (payload) => {
      setKicked(payload?.message || "Tu as été kick");
      nav("/play", { replace: true });
    };

    c.onClosed = (payload) => {
      setLobbyClosed(payload?.reason || "unknown");
      nav("/play", { replace: true });
    };

    c.onError = (payload) => setError(payload?.message || "Erreur");

    (async () => {
      try {
        await c.connect(join_code);
        c.hello(device_id);
      } catch {
        setError("Room introuvable");
      }
    })();

    return () => c.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join_code, device_id]);

  const visible = useMemo(() => {
    return players.filter(p => p.active && p.status !== "disabled");
  }, [players]);

  return (
    <div style={{ padding: 18, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Choisir un player</h1>
      <div style={{ color: "var(--muted)", fontWeight: 800, marginBottom: 10 }}>
        Code: <span style={{ fontWeight: 1000 }}>{join_code}</span>
      </div>

      {error && (
        <div style={{ marginBottom: 10, padding: 12, borderRadius: 14, border: "1px solid var(--border)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {visible.map((p) => {
          const disabled = p.status !== "free";
          const label =
            p.status === "free" ? "Libre" :
            p.status === "connected" ? "Déjà pris" :
            p.status === "afk" ? `Réservé (${p.afk_seconds_left ?? "…"}s)` :
            "Désactivé";

          return (
            <button
              key={p.id}
              disabled={disabled}
              onClick={() => clientRef.current?.claimPlayer(device_id, p.id)}
              style={{
                textAlign: "left",
                padding: 14,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)",
                color: "var(--text)",
                opacity: disabled ? 0.7 : 1
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 1000 }}>{p.name}</div>
                <div style={{ color: "var(--muted)", fontWeight: 800 }}>{label}</div>
              </div>
              <div style={{ color: "var(--muted)", fontWeight: 800, marginTop: 4 }}>
                {p.id}
              </div>
            </button>
          );
        })}
      </div>

      <ClaimAckBridge
        clientRef={clientRef}
        device_id={device_id}
        onClaimed={(player_id, token) => {
          setClaim(player_id, token);
          nav("/play/wait");
        }}
        setError={setError}
      />
    </div>
  );
}

/**
 * Bridge minimal: on intercepte les ACKs envoyés par le serveur sur claim_player.
 * Comme notre PlayLobbyClient est minimal, on lit directement ws messages.
 */
function ClaimAckBridge(props: {
  clientRef: React.MutableRefObject<PlayLobbyClient | null>;
  device_id: string;
  onClaimed: (player_id: string, token: string) => void;
  setError: (s: string) => void;
}) {
  const attachedRef = useRef(false);

  useEffect(() => {
    const c = props.clientRef.current;
    if (!c?.ws || attachedRef.current) return;

    attachedRef.current = true;
    const ws = c.ws;

    const handler = (ev: MessageEvent) => {
      let msg: any = null;
      try { msg = JSON.parse(ev.data); } catch { return; }

      // ACK payload: { ok: true, player_session_token }
      if (msg?.type === "ack" && msg?.payload?.player_session_token) {
        // We don't know which player in ack; server also broadcasts lobby_state quickly.
        // But simplest: detect last clicked is hard; instead we infer from lobby_state (free->connected with this device isn't visible).
        // MVP: server can be extended later to include player_id in ack. For now: treat as success and send to /wait after next state updates.
        // We need player_id: workaround: ask server to include it in ack? Not possible here. So we use msg.payload.player_id if present.
        const player_id = msg.payload.player_id;
        const token = msg.payload.player_session_token;
        if (player_id) props.onClaimed(player_id, token);
      }

      if (msg?.type === "error" && msg?.payload?.code === "TAKEN") {
        props.setError("Pris à l’instant");
      }
      if (msg?.type === "error" && msg?.payload?.code === "DOUBLE_DEVICE") {
        props.setError("Tu as déjà un player");
      }
    };

    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [props]);

  return null;
}
