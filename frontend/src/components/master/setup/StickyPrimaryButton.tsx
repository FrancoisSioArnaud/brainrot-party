import React from "react";

export default function StickyPrimaryButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div style={{ position: "sticky", bottom: 16, display: "flex", justifyContent: "flex-end", paddingTop: 6 }}>
      <button
        disabled={disabled}
        onClick={onClick}
        style={{
          padding: "12px 16px",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: disabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.10)",
          color: "var(--text)",
          fontWeight: 900,
          opacity: disabled ? 0.6 : 1
        }}
      >
        {label}
      </button>
    </div>
  );
}
