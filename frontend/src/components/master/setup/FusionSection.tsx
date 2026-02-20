import React, { useMemo, useState } from "react";
import { useDraftStore } from "../../../store/draftStore";
import FusionModal from "./FusionModal";

export default function FusionSection() {
  const files = useDraftStore(s => s.files);
  const senders = useDraftStore(s => s.senders);

  const [open, setOpen] = useState(false);

  const enabled = files.length >= 2;
  const autoCount = useMemo(() => senders.filter(s => !s.hidden && s.badge === "auto").length, [senders]);
  const manualCount = useMemo(() => senders.filter(s => !s.hidden && s.badge === "manual").length, [senders]);

  return (
    <div style={{ opacity: enabled ? 1 : 0.5 }}>
      <h2 style={{ marginTop: 0 }}>Fusion</h2>

      {!enabled && (
        <div style={{ color: "var(--muted)", fontWeight: 800 }}>
          Ajoute au moins 2 fichiers pour fusionner.
        </div>
      )}

      {enabled && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 6 }}>
            <div style={{ color: "var(--muted)", fontWeight: 800 }}>{autoCount} fusions automatiques</div>
            <div style={{ color: "var(--muted)", fontWeight: 800 }}>{manualCount} fusions manuelles</div>
          </div>

          <button
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text)",
              fontWeight: 900
            }}
            onClick={() => setOpen(true)}
          >
            Ouvrir la fusion
          </button>

          <FusionModal open={open} onClose={() => setOpen(false)} />
        </>
      )}
    </div>
  );
}
