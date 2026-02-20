import React from "react";
import { useGameStore } from "../../../store/gameStore";
import Avatar from "../../common/Avatar";

export default function RemainingSendersBar() {
  const remaining = useGameStore(s => s.remaining_sender_ids);
  const senders = useGameStore(s => s.senders);

  const list = remaining.map(id => senders.find(s => s.id === id)).filter(Boolean) as any[];

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 12, boxShadow: "var(--shadow)" }}>
      <div style={{ fontWeight: 1000, marginBottom: 8 }}>Senders restants</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {list.map((s) => (
          <div key={s.id} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
            <Avatar src={s.photo_url} size={44} label={s.name} />
            <div style={{ fontSize: 12, fontWeight: 900, maxWidth: 92, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.name}
            </div>
          </div>
        ))}
        {list.length === 0 && <div style={{ color: "var(--muted)", fontWeight: 800 }}>—</div>}
      </div>
    </div>
  );
}
