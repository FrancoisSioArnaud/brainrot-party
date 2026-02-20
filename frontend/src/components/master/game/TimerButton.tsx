import React, { useMemo } from "react";
import { useGameStore } from "../../../store/gameStore";

export default function TimerButton({ onStart }: { onStart: (item_id: string) => void }) {
  const focus = useGameStore(s => s.focus_item_id);
  const phase = useGameStore(s => s.room?.phase);

  const enabled = useMemo(() => !!focus && (phase === "VOTING" || phase === "TIMER_RUNNING" || phase === "OPEN_REEL"), [focus, phase]);

  return (
    <button
      disabled={!enabled}
      onClick={() => focus && onStart(focus)}
      style={{
        padding: "12px 14px",
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: enabled ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
        color: "var(--text)",
        fontWeight: 1000,
        opacity: enabled ? 1 : 0.6
      }}
    >
      Lancer 10s
    </button>
  );
}
