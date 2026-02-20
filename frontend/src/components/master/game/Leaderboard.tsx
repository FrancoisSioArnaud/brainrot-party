import React from "react";
import { useGameStore } from "../../../store/gameStore";

export default function Leaderboard() {
  const players = useGameStore(s => s.players);

  const list = players.filter(p => p.active).slice().sort((a,b)=>b.score-a.score);

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 12, boxShadow: "var(--shadow)" }}>
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>Leaderboard</div>
      <div style={{ display: "grid", gap: 6 }}>
        {list.map((p, idx) => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ fontWeight: 900 }}>{idx+1}. {p.name}</div>
            <div style={{ fontWeight: 1000 }}>{p.score}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
