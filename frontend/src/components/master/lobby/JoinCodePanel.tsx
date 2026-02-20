import React from "react";
import QRCode from "../../common/QRCode";

export default function JoinCodePanel({ joinCode }: { joinCode: string }) {
  // QR avec code pré-rempli
  const playUrl = `${window.location.origin}/play?code=${encodeURIComponent(joinCode)}`;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 280,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        padding: 14,
        boxShadow: "var(--shadow)",
        display: "flex",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ color: "var(--muted)", fontWeight: 900 }}>Code</div>
        <div style={{ fontSize: 34, fontWeight: 1000, letterSpacing: 3 }}>{joinCode}</div>
        <button
          style={{
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.06)",
            color: "var(--text)",
            fontWeight: 900,
          }}
          onClick={() => navigator.clipboard.writeText(joinCode)}
        >
          Copier
        </button>
        <div style={{ marginTop: 10, color: "var(--muted)", fontWeight: 800 }}>
          Scanne le QR code ou ouvre /play sur mobile.
        </div>
      </div>
      <div>
        <QRCode value={playUrl} />
      </div>
    </div>
  );
}
