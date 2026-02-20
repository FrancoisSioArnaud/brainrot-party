import React, { useState } from "react";
import Modal from "../../common/Modal";

export default function StartGameBar({
  ready,
  onBackSetup,
  onStart,
}: {
  ready: boolean;
  onBackSetup: () => void;
  onStart: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
        <button
          style={{
            padding: "10px 12px",
            borderRadius: 14,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text)",
            fontWeight: 900,
          }}
          onClick={onBackSetup}
        >
          Retour au Setup
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
            opacity: ready ? 1 : 0.6,
          }}
          onClick={() => {
            if (!ready) return;
            setOpen(true);
          }}
        >
          Start game
        </button>
      </div>

      <Modal
        open={open}
        title="Démarrer la partie ?"
        onClose={() => setOpen(false)}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "var(--muted)", fontWeight: 900 }}>
            Tout devient définitif : seed, rounds, scores, photos.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              style={{
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.04)",
                color: "var(--text)",
                fontWeight: 1000,
              }}
              onClick={() => setOpen(false)}
            >
              Annuler
            </button>
            <button
              style={{
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.10)",
                color: "var(--text)",
                fontWeight: 1000,
              }}
              onClick={() => {
                setOpen(false);
                onStart();
              }}
            >
              Confirmer
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
