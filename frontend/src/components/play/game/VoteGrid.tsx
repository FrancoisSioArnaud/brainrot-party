import React from "react";
import { GameSender } from "../../../store/gameStore";
import SenderTile from "./SenderTile";

export default function VoteGrid({
  senders,
  selected,
  onToggle
}: {
  senders: GameSender[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
      {senders.map((s) => (
        <SenderTile key={s.id} sender={s} selected={selected.includes(s.id)} onClick={() => onToggle(s.id)} />
      ))}
    </div>
  );
}
