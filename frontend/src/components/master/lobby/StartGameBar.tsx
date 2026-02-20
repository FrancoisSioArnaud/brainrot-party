import React from "react";

export default function StartGameBar({
  ready,
  onBackSetup,
  onStart
}: {
  ready: boolean;
  onBackSetup: () => void;
  onStart: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
      <button
        style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)", color: "var(--text)", fontWeight: 900 }}
        onClick={onBackSetup}
      >
        Retour Setup
      </button>
      <button
        disabled={!ready}
        style={{
          padding: "12px 16px",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: ready ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
          color: "var(--text)",
          fontWeight: 1000,
          opacity: ready ? 1 : 0.6
        }}
        onClick={() => {
          if (!ready) return;
          if (!confirm("Tout devient définitif. Continuer ?")) return;
          onStart();
        }}
      >
        Start game
      </button>
    </div>
  );
}
