import React from "react";

export default function VoteFooter({
  selectedCount,
  k,
  onSubmit
}: {
  selectedCount: number;
  k: number;
  onSubmit: () => void;
}) {
  return (
    <div style={{ marginTop: 12, position: "sticky", bottom: 12 }}>
      <button
        onClick={onSubmit}
        style={{
          width: "100%",
          padding: "14px 14px",
          borderRadius: 18,
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.10)",
          color: "var(--text)",
          fontWeight: 1100,
          display: "flex",
          justifyContent: "space-between"
        }}
      >
        <span>Voter</span>
        <span>{selectedCount}/{k}</span>
      </button>
    </div>
  );
}
