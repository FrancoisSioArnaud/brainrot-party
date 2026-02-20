import React from "react";
import { LobbyPlayer } from "../../../ws/lobbyClient";
import Avatar from "../../common/Avatar";

export default function PlayersList({ players, onPick }: { players: LobbyPlayer[]; onPick: (p: LobbyPlayer) => void }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {players.map((p) => {
        const disabled = p.status !== "free";
        return (
          <button
            key={p.id}
            disabled={disabled}
            onClick={() => onPick(p)}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "12px 12px",
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--text)",
              opacity: disabled ? 0.55 : 1
            }}
          >
            <Avatar src={p.photo_url} size={44} label={p.name} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontWeight: 1000 }}>{p.name}</div>
              <div style={{ color: "var(--muted)", fontWeight: 900 }}>{p.status}</div>
            </div>
            <div style={{ fontWeight: 1000 }}>{disabled ? "Pris" : "Choisir"}</div>
          </button>
        );
      })}
    </div>
  );
}
