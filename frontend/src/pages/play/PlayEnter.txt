import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlayStore } from "../../store/playStore";

function normalizeCode(input: string) {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
}

export default function PlayEnter() {
  const nav = useNavigate();
  const setJoinCode = usePlayStore(s => s.setJoinCode);
  const kicked = usePlayStore(s => s.kicked_message);
  const closed = usePlayStore(s => s.lobby_closed_reason);

  const [code, setCode] = useState("");

  return (
    <div style={{ padding: 18, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Rejoindre</h1>

      {kicked && (
        <div style={{ marginBottom: 10, padding: 12, borderRadius: 14, border: "1px solid var(--border)" }}>
          {kicked}
        </div>
      )}
      {closed && (
        <div style={{ marginBottom: 10, padding: 12, borderRadius: 14, border: "1px solid var(--border)" }}>
          Lobby fermé ({closed})
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <input
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          placeholder="AB12CD"
          style={{
            padding: "14px 12px",
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text)",
            fontWeight: 1000,
            fontSize: 20,
            letterSpacing: 2
          }}
        />
        <button
          style={{
            padding: "12px 12px",
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.08)",
            color: "var(--text)",
            fontWeight: 1000
          }}
          onClick={() => {
            if (code.length !== 6) return;
            setJoinCode(code);
            nav("/play/choose");
          }}
        >
          Rejoindre
        </button>
      </div>
    </div>
  );
}
