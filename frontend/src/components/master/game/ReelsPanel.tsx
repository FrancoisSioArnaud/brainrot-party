import React, { useMemo } from "react";
import { useGameStore } from "../../../store/gameStore";

export default function ReelsPanel({ onOpen }: { onOpen: (item_id: string, url?: string | null) => void }) {
  const items = useGameStore(s => s.items);
  const focus = useGameStore(s => s.focus_item_id);
  const reel_urls = useGameStore(s => s.reel_urls_by_item);

  const focusItem = useMemo(() => items.find(i => i.id === focus) || null, [items, focus]);
  const others = useMemo(() => items.filter(i => i.id !== focus), [items, focus]);

  const tile = (it: any, big: boolean) => (
    <div
      key={it.id}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 16,
        background: "rgba(255,255,255,0.03)",
        padding: 10,
        display: "grid",
        gap: 10
      }}
    >
      <div style={{ aspectRatio: "1 / 1", borderRadius: 14, border: "1px dashed rgba(241,241,247,0.25)", display: "grid", placeItems: "center" }}>
        <button
          style={{ padding: big ? "12px 14px" : "8px 10px", borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,0.06)", color: "var(--text)", fontWeight: 1000 }}
          onClick={() => onOpen(it.id, reel_urls ? reel_urls[it.id] : null)}
        >
          Ouvrir
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {Array.from({ length: it.k }).map((_, idx) => (
          <div key={idx} style={{ width: 18, height: 18, borderRadius: 999, border: "2px dashed rgba(241,241,247,0.35)" }} />
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)" }}>
      <h2 style={{ marginTop: 0 }}>Round</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12, alignItems: "start" }}>
        <div>{focusItem ? tile(focusItem, true) : <div style={{ color: "var(--muted)", fontWeight: 900 }}>—</div>}</div>
        <div style={{ display: "grid", gap: 10 }}>
          {others.slice(0, 8).map((it) => tile(it, false))}
        </div>
      </div>
    </div>
  );
}
