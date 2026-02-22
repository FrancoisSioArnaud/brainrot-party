import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import styles from "./Lobby.module.css";

import JoinCodePanel from "../../components/master/lobby/JoinCodePanel";
import PlayersGrid from "../../components/master/lobby/PlayersGrid";
import StartGameBar from "../../components/master/lobby/StartGameBar";
import SpinnerOverlay from "../../components/common/SpinnerOverlay";
import { toast } from "../../components/common/Toast";

import { useDraftStore, buildLobbyDraftPayload } from "../../store/draftStore";
import { useLobbyStore } from "../../store/lobbyStore";
import { LobbyClient, LobbyState } from "../../ws/lobbyClient";

async function closeLobbyHttp(
  join_code: string,
  master_key: string,
  reason: "reset" | "start_game" | "unknown" = "reset"
) {
  await fetch(`/lobby/${join_code}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ master_key, reason }),
  });
}

export default function MasterLobby() {
  const nav = useNavigate();

  const local_room_id = useDraftStore((s) => s.local_room_id);
  const join_code = useDraftStore((s) => s.join_code);
  const master_key = useDraftStore((s) => s.master_key);

  const lobbyPlayers = useLobbyStore((s) => s.players);
  const readyToStart = useLobbyStore((s) => s.readyToStart);
  const setPlayers = useLobbyStore((s) => s.setPlayers);

  const [busy, setBusy] = useState(false);
  const [wsError, setWsError] = useState<string>("");

  const clientRef = useRef<LobbyClient | null>(null);
  const startPendingRef = useRef(false);

  useEffect(() => {
    if (!local_room_id || !join_code || !master_key) {
      nav("/master/setup", { replace: true });
      return;
    }

    const c = new LobbyClient();
    clientRef.current = c;
    c.bind();

    c.onState = (st: LobbyState) => {
      setPlayers(st.players || []);
      setWsError("");
    };

    c.onError = (_code, message) => {
      setWsError(message || "Erreur");
    };

    c.onEvent = (type, payload) => {
      if (type === "lobby_closed") {
        const reason = String(payload?.reason || "");

        // ✅ START GAME: ne pas renvoyer vers setup
        if (reason === "start_game") {
          startPendingRef.current = true;

          const roomCode = String(payload?.room_code || "");
          if (roomCode) {
            nav(`/master/game/${encodeURIComponent(roomCode)}`, { replace: true });
          } else {
            toast("Démarrage…");
          }
          return;
        }

        toast("Lobby fermé");
        nav("/master/setup", { replace: true });
        return;
      }

      if (type === "game_room_created") {
        const roomCode = String(payload?.room_code || "");
        if (roomCode) nav(`/master/game/${encodeURIComponent(roomCode)}`, { replace: true });
        return;
      }
    };

    (async () => {
      try {
        setBusy(true);
        await c.connectMaster(join_code);

        // hello first, then push full draft snapshot
        c.masterHello(master_key, local_room_id);
        c.syncFromDraft(master_key, buildLobbyDraftPayload());
      } catch {
        toast("Connexion WS impossible");
        nav("/master/setup", { replace: true });
      } finally {
        setBusy(false);
      }
    })();

    return () => {
      try {
        c.ws.disconnect();
      } catch {}
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local_room_id, join_code, master_key]);

  // ✅ "Pris" = tout player actif non-disabled dont le status n'est pas "free"
  const takenCount = useMemo(() => {
    return lobbyPlayers.filter((p) => p.active && p.status !== "disabled" && p.status !== "free").length;
  }, [lobbyPlayers]);

  if (!local_room_id || !join_code || !master_key) return null;

  return (
    <div className={styles.root}>
      <SpinnerOverlay open={busy} text="Connexion…" />

      <div className={styles.header}>
        <JoinCodePanel joinCode={join_code} />

        <div className={styles.meta}>
          <div className={styles.line}>
            <div className={styles.k}>Pris</div>
            <div className={styles.v}>{takenCount}</div>
          </div>
          <div className={styles.line} style={{ marginTop: 8 }}>
            <div className={styles.k}>Players</div>
            <div className={styles.v}>{lobbyPlayers.length}</div>
          </div>
          {wsError ? (
            <div style={{ marginTop: 10, color: "#ffb4b4", fontWeight: 900 }}>{wsError}</div>
          ) : null}
        </div>
      </div>

      <PlayersGrid
        players={lobbyPlayers}
        onCreate={async () => {
          const name = (prompt("Nom du player ?") || "").trim();
          if (!name) return;
          try {
            await clientRef.current?.createManualPlayer(master_key, name);
          } catch {
            toast("Impossible de créer le player");
          }
        }}
        onDelete={async (id) => {
          if (!confirm("Supprimer ce player ?")) return;
          try {
            await clientRef.current?.deletePlayer(master_key, id);
          } catch {
            toast("Suppression impossible");
          }
        }}
        onToggleActive={async (id, active) => {
          try {
            await clientRef.current?.setPlayerActive(master_key, id, active);
          } catch {
            toast("Action impossible");
          }
        }}
      />

      <StartGameBar
        ready={readyToStart}
        onBackSetup={() => nav("/master/setup")}
        onStart={async () => {
          try {
            setBusy(true);
            startPendingRef.current = true;
            await clientRef.current?.startGame(master_key);
            // On attend lobby_closed(start_game) puis navigation
          } catch {
            startPendingRef.current = false;
            toast("Impossible de démarrer");
          } finally {
            setBusy(false);
          }
        }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          style={{
            padding: "10px 12px",
            borderRadius: 14,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text)",
            fontWeight: 900,
          }}
          onClick={async () => {
            if (!confirm("Fermer le lobby et kick les mobiles ?")) return;
            try {
              setBusy(true);
              await closeLobbyHttp(join_code, master_key, "reset");
              nav("/master/setup", { replace: true });
            } catch {
              toast("Impossible de fermer le lobby");
            } finally {
              setBusy(false);
            }
          }}
        >
          Fermer le lobby
        </button>
      </div>
    </div>
  );
}
