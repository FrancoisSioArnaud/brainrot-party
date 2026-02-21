// frontend/src/components/master/game/PlayersPanel.tsx
import React, { useMemo } from "react";
import styles from "./PlayersPanel.module.css";
import PlayerBadge from "./PlayerBadge";
// File is named VotePlacard.tsx (component exported is VotePlacards)
import VotePlacards from "./VotePlacard";

export default function PlayersPanel(props: {
  players: Array<{ id: string; name: string; active: boolean; photo_url: string | null; score: number }>;
  senders: Array<{ id_local: string; name: string; active: boolean; photo_url?: string | null }>;

  showPlacards: boolean;
  k: number;

  votesByPlayer: Record<string, string[]>;
  correctnessByPlayerSender: Record<string, Record<string, boolean>>;
  revealStep: number;
}) {
  const playersSorted = useMemo(() => {
    const arr = [...props.players];
    arr.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return arr;
  }, [props.players]);

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>Players</div>

      {props.showPlacards ? (
        <VotePlacards
          players={playersSorted}
          senders={props.senders}
          votesByPlayer={props.votesByPlayer}
          correctnessByPlayerSender={props.correctnessByPlayerSender}
          revealStep={props.revealStep}
        />
      ) : null}

      <div className={styles.grid}>
        {playersSorted.map((p) => (
          <PlayerBadge key={p.id} name={p.name} score={p.score} inactive={!p.active} />
        ))}
      </div>
    </div>
  );
}
