import React from "react";
import { useDraftStore } from "../../../store/draftStore";

export default function StatsPanel() {
  const s = useDraftStore(st => st.stats);

  const row = (k: string, v: any) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ color: "var(--muted)", fontWeight: 900 }}>{k}</div>
      <div style={{ fontWeight: 900 }}>{v ?? "—"}</div>
    </div>
  );

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)" }}>
      <h3 style={{ marginTop: 0 }}>Stats</h3>
      {row("Senders actifs", s.active_senders)}
      {row("ReelItems", s.reel_items)}
      {row("Rounds max", s.rounds_max)}
      {row("Rounds complets", s.rounds_complete)}
      {row("Senders dédoublonnés", s.dedup_senders)}
      {row("Rejets", s.rejected_total)}
    </div>
  );
}
