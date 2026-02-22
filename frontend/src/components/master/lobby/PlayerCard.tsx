import React from "react";
//import styles from "./PlayerCard.module.css";
import type { LobbyPlayer } from "../../../store/lobbyStore";

function labelForStatus(p: LobbyPlayer): { text: string; className: string } {
  if (!p.active || p.status === "disabled") return { text: "Désactivé", className: styles.badgeDisabled };
  if (p.status === "free") return { text: "Libre", className: styles.badgeFree };
  return { text: "Pris", className: styles.badgeTaken };
}

export default function PlayerCard({
  player,
  onDelete,
  onToggleActive,
}: {
  player: LobbyPlayer;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
}) {
  const badge = labelForStatus(player);

  return (
    <div className={styles.card}>
      <div className={styles.avatar}>
        {player.photo_url ? <img src={player.photo_url} alt="" /> : null}
      </div>

      <div className={styles.info}>
        <div className={styles.name}>{player.name}</div>
        <div className={`${styles.badge} ${badge.className}`}>{badge.text}</div>
      </div>

      <div className={styles.actions}>
        {player.type === "sender_linked" ? (
          <label className={styles.toggleRow}>
            <input
              type="checkbox"
              checked={player.active && player.status !== "disabled"}
              onChange={(e) => onToggleActive(player.id, e.target.checked)}
            />
            <span>Actif</span>
          </label>
        ) : (
          <button className={styles.delete} onClick={() => onDelete(player.id)}>
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}
