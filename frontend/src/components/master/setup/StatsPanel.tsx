import React from "react";
import { useDraftStore } from "../../../store/draftStore";

function formatMaybeNumber(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return String(v);
}

export default function StatsPanel() {
  const stats = useDraftStore(s => s.stats);

  return (
    <div
      style={{
        position: "sticky",
        top: 16,
        border: "1px solid var(--border)",
        borderRadius: 18,
        padding: 14,
        background: "rgba(255,255,255,0.03)"
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 10 }}>Stats</h3>

      <div style={{ display: "grid", gap: 10 }}>
        <Row label="Senders actifs" value={stats.active_senders} />
        <Row label="ReelItems uniques" value={stats.reel_items} />
        <Row label="Rounds max (2e sender)" value={formatMaybeNumber(stats.rounds_max)} />
        <Row label="Rounds complets (min sender)" value={formatMaybeNumber(stats.rounds_complete)} />
        <Row label="Senders dédoublonnés" value={stats.dedup_senders} />
        <Row label="Rejets total" value={stats.rejected_total} />
      </div>
    </div>
  );
}

function Row(props: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        alignItems: "center"
      }}
    >
      <div style={{ color: "var(--muted)", fontWeight: 800 }}>{props.label}</div>
      <div style={{ fontWeight: 1000, letterSpacing: 0.2 }}>{props.value}</div>
    </div>
  );
}
