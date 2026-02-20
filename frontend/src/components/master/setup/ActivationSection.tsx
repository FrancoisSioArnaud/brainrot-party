import React, { useMemo } from "react";
import { useDraftStore } from "../../../store/draftStore";

export default function ActivationSection() {
  const files = useDraftStore(s => s.files);
  const senders = useDraftStore(s => s.senders);
  const toggle = useDraftStore(s => s.toggleSenderActive);
  const rename = useDraftStore(s => s.renameSender);
  const parsingBusy = useDraftStore(s => s.parsing_busy);

  const enabled = files.length > 0;

  const list = useMemo(() => {
    return senders
      .filter(s => !s.hidden)
      .slice()
      .sort((a, b) => b.reel_count_total - a.reel_count_total);
  }, [senders]);

  return (
    <div style={{ opacity: enabled ? 1 : 0.5, pointerEvents: parsingBusy ? "none" : "auto" }}>
      <h2 style={{ marginTop: 0 }}>Activation</h2>
      {!enabled && <div style={{ color: "var(--muted)", fontWeight: 800 }}>Importe au moins 1 fichier.</div>}

      {enabled && (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {list.map((s) => {
            const disabled = s.reel_count_total === 0;
            return (
              <div
                key={s.sender_id_local}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.03)",
                  opacity: disabled ? 0.55 : 1
                }}
              >
                <input
                  type="checkbox"
                  checked={s.active && !disabled}
                  disabled={disabled || parsingBusy}
                  onChange={() => toggle(s.sender_id_local)}
                />
                <div style={{ minWidth: 0 }}>
                  <input
                    value={s.display_name}
                    onChange={(e) => rename(s.sender_id_local, e.target.value)}
                    disabled={parsingBusy}
                    style={{
                      width: "100%",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "rgba(255,255,255,0.04)",
                      color: "var(--text)",
                      padding: "8px 10px",
                      fontWeight: 900
                    }}
                  />
                  <div style={{ color: "var(--muted)", fontWeight: 800, marginTop: 4 }}>
                    a envoyé {s.reel_count_total} reels
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {s.badge !== "none" && (
                    <span
                      style={{
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.04)",
                        fontWeight: 900
                      }}
                    >
                      {s.badge === "auto" ? "Fusion Auto" : "Fusion Manuelle"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
