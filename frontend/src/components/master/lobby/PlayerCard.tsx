import React from "react";
import Avatar from "../../common/Avatar";
import { LobbyPlayer } from "../../../store/lobbyStore";

function badgeColor(status: LobbyPlayer["status"]) {
  if (status === "connected") return "var(--ok)";
  if (status === "afk") return "var(--warn)";
  if (status === "disabled") return "var(--danger)";
  return "rgba(241,241,247,0.55)";
}

export default function PlayerCard({
  p,
  onDelete,
  onToggleActive
}: {
  p: LobbyPlayer;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 12, background: "rgba(255,255,255,0.03)", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Avatar src={p.photo_url} size={46} label={p.name} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 1000, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
          <div style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: badgeColor(p.status) }} />
            <span style={{ color: "var(--muted)", fontWeight: 900 }}>{p.status.toUpperCase()}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        {p.type === "sender_linked" ? (
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
            <input
              type="checkbox"
              checked={p.active && p.status !== "disabled"}
              onChange={(e) => onToggleActive(p.id, e.target.checked)}
            />
            Actif
          </label>
        ) : (
          <div style={{ color: "var(--muted)", fontWeight: 900 }}>Manuel</div>
        )}

        {p.type === "manual" && (
          <button
            style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontWeight: 900 }}
            onClick={() => onDelete(p.id)}
          >
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}
