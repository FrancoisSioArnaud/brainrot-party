import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerToClientMsg } from "@brp/contracts/ws";
import type { PlayerVisible, StateSyncRes } from "@brp/contracts";

import { BrpWsClient } from "../../lib/wsClient";
import { clearPlaySession, loadPlaySession } from "../../lib/storage";

type VoteUi = {
  active: boolean;
  round_id: string;
  item_id: string;
  k: number;
  senders_selectable: string[];
};

export default function PlayGame() {
  const nav = useNavigate();
  const session = useMemo(() => loadPlaySession(), []);
  const clientRef = useRef<BrpWsClient | null>(null);

  const [wsStatus, setWsStatus] = useState("disconnected");
  const [err, setErr] = useState("");

  const [phase, setPhase] = useState<string>("—");
  const [players, setPlayers] = useState<PlayerVisible[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});

  const [voteUi, setVoteUi] = useState<VoteUi | null>(null);
  const [selections, setSelections] = useState<string[]>([]);
  const [acked, setAcked] = useState(false);

  useEffect(() => {
    if (!session) return;

    const c = new BrpWsClient();
    clientRef.current?.close();
    clientRef.current = c;

    setWsStatus("connecting");
    setErr("");

    c.connectJoinRoom(
      { room_code: session.room_code, device_id: session.device_id },
      {
        onOpen: () => setWsStatus("open"),
        onClose: () => setWsStatus("closed"),
        onError: () => setWsStatus("error"),
        onMessage: (m) => onMsg(m),
      }
    );

    return () => c.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.room_code]);

  useEffect(() => {
    if (phase === "lobby") nav("/play", { replace: true });
  }, [phase, nav]);

  function onMsg(m: ServerToClientMsg) {
    if (m.type === "ERROR") {
      const msg = `${m.payload.error}${m.payload.message ? `: ${m.payload.message}` : ""}`;
      setErr(msg);

      if (m.payload.error === "room_expired" || m.payload.error === "room_not_found") {
        clearPlaySession();
        nav("/play", { replace: true });
      }
      return;
    }

    if (m.type === "STATE_SYNC_RESPONSE") {
      const p = m.payload as StateSyncRes;
      setPhase(p.phase);
      setPlayers(p.players_visible ?? []);
      setMyPlayerId(p.my_player_id ?? null);
      setScores(p.scores ?? {});
      return;
    }

    if (m.type === "NEW_ITEM") {
      setErr("");
      setVoteUi(null);
      setSelections([]);
      setAcked(false);
      return;
    }

    if (m.type === "START_VOTE") {
      setErr("");
      setVoteUi({
        active: true,
        round_id: m.payload.round_id,
        item_id: m.payload.item_id,
        k: m.payload.k,
        senders_selectable: (m.payload as any).senders_selectable ?? [],
      });
      setSelections([]);
      setAcked(false);
      return;
    }

    if (m.type === "VOTE_ACK") {
      setAcked((m.payload as any).accepted === true);
      if ((m.payload as any).accepted !== true) {
        setErr(`Vote refusé: ${(m.payload as any).reason ?? "unknown"}`);
      }
      return;
    }

    if (m.type === "VOTE_RESULTS") {
      setScores((m.payload as any).scores ?? {});
      return;
    }

    if (m.type === "GAME_OVER") {
      setScores((m.payload as any).scores ?? {});
      return;
    }
  }

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Game (Play)</div>
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          Pas de session play. Reviens sur /play.
        </div>
      </div>
    );
  }

  const leaderboard = Object.entries(scores)
    .map(([player_id, score]) => ({
      player_id,
      score: typeof score === "number" ? score : 0,
      name: players.find((p) => p.player_id === player_id)?.name ?? player_id,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  function toggleSelection(sender_id: string) {
    if (!voteUi) return;

    setSelections((prev) => {
      const has = prev.includes(sender_id);
      if (has) return prev.filter((x) => x !== sender_id);

      if (prev.length >= voteUi.k) return prev;
      return [...prev, sender_id];
    });
  }

  function submitVote() {
    if (!voteUi) return;
    if (!myPlayerId) {
      setErr("Choisis un joueur dans le lobby avant de voter.");
      return;
    }
    if (selections.length !== voteUi.k) return;

    setErr("");
    clientRef.current?.send({
      type: "SUBMIT_VOTE",
      payload: {
        round_id: voteUi.round_id,
        item_id: voteUi.item_id,
        selections,
      },
    });
  }

  const isGameOver = phase === "game_over";

  return (
    <div className="card">
      <div className="h1">Game (Play)</div>

      <div className="row" style={{ marginTop: 8 }}>
        <span className="badge ok">WS: {wsStatus}</span>
        <span className="badge ok">phase: {phase}</span>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      {isGameOver ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Classement final</div>
          {leaderboard.length === 0 ? (
            <div className="small">Aucun score.</div>
          ) : (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {leaderboard.map((r, i) => (
                <div key={r.player_id} className="row" style={{ justifyContent: "space-between" }}>
                  <span className="mono">
                    {i + 1}. {r.name}
                  </span>
                  <span className="badge ok">{r.score}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : voteUi ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">Vote</div>
          <div className="small" style={{ opacity: 0.8 }}>
            Choisis {voteUi.k} sender(s)
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {voteUi.senders_selectable.map((sid) => {
              const selected = selections.includes(sid);
              return (
                <button
                  key={sid}
                  className="btn"
                  onClick={() => toggleSelection(sid)}
                  style={{
                    textAlign: "left",
                    opacity: selected ? 1 : 0.9,
                    borderColor: selected ? "rgba(255,255,255,0.55)" : undefined,
                  }}
                >
                  {selected ? "✓ " : ""} {sid}
                </button>
              );
            })}
          </div>

          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn" disabled={selections.length !== voteUi.k || acked} onClick={submitVote}>
              {acked ? "Envoyé" : "Valider"}
            </button>
            <div className="small mono" style={{ opacity: 0.8 }}>
              {selections.length}/{voteUi.k}
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2">En attente</div>
          <div className="small">Regarde l’écran principal.</div>
        </div>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">{isGameOver ? "Scores finaux" : "Scores"}</div>
        {leaderboard.length === 0 ? (
          <div className="small">Aucun score.</div>
        ) : (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {leaderboard.slice(0, 6).map((r, i) => (
              <div key={r.player_id} className="row" style={{ justifyContent: "space-between" }}>
                <span className="mono">
                  {i + 1}. {r.name}
                </span>
                <span className="badge ok">{r.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
