import React from "react";
import { useGameStore } from "../../../store/gameStore";
import Avatar from "../../common/Avatar";

export default function PlayersBar() {
  const players = useGameStore(s => s.players);

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 12, boxShadow: "var(--shadow)" }}>
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>Players</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {players.filter(p => p.active).map((p) => (
          <div key={p.id} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
            <Avatar src={p.photo_url} size={50} label={p.name} />
            <div style={{ fontSize: 12, fontWeight: 900, maxWidth: 110, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {p.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
