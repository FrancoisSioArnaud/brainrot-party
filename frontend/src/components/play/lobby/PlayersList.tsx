import React from "react";
import Avatar from "../../common/Avatar";
import { LobbyPlayerLite } from "../../../ws/playLobbyClient";

function statusLabel(p: LobbyPlayerLite) {
  if (p.status === "free") return "Libre";
  if (p.status === "connected") return "Déjà pris";
  if (p.status === "afk") return `Réservé (${p.afk_seconds_left ?? "…"}s)`;
  return "Désactivé";
}

export default function PlayersList({
  players,
  onPick,
}: {
  players: LobbyPlayerLite[];
  onPick: (p: LobbyPlayerLite) => void;
}) {
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
              background: disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)",
              color: "var(--text)",
              opacity: disabled ? 0.7 : 1,
              textAlign: "left",
            }}
          >
            <Avatar src={p.photo_url || null} size={44} label={p.name} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 1000, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {p.name}
              </div>
              <div style={{ color: "var(--muted)", fontWeight: 900, marginTop: 3 }}>
                {statusLabel(p)}
              </div>
            </div>
            <div style={{ fontWeight: 1000 }}>{disabled ? "—" : "Choisir"}</div>
          </button>
        );
      })}
    </div>
  );
}
