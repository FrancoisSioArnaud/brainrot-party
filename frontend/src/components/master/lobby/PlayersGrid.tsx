import React from "react";
import { LobbyPlayer } from "../../../store/lobbyStore";
import PlayerCard from "./PlayerCard";

export default function PlayersGrid({
  players,
  onCreate,
  onDelete,
  onToggleActive
}: {
  players: LobbyPlayer[];
  onCreate: () => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
}) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Players</h2>
        <button
          style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,0.06)", color: "var(--text)", fontWeight: 900 }}
          onClick={onCreate}
        >
          Créer un player
        </button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {players.map((p) => (
          <PlayerCard key={p.id} p={p} onDelete={onDelete} onToggleActive={onToggleActive} />
        ))}
      </div>
    </div>
  );
}
