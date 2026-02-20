import React from "react";
import { GameSender } from "../../../store/gameStore";
import Avatar from "../../common/Avatar";

export default function SenderTile({
  sender,
  selected,
  onClick
}: {
  sender: GameSender;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "grid",
        gap: 8,
        justifyItems: "center",
        padding: "12px 10px",
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: selected ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
        color: "var(--text)"
      }}
    >
      <Avatar src={sender.photo_url} size={54} label={sender.name} />
      <div style={{ fontWeight: 1000, fontSize: 13, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>
        {sender.name}
      </div>
    </button>
  );
}
