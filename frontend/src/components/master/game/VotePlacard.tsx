import React, { useMemo } from "react";
import styles from "./VotePlacards.module.css";
import SenderBadge from "./SenderBadge";

export default function VotePlacards(props: {
  players: Array<{ id: string; name: string; active: boolean }>;
  senders: Array<{ id_local: string; name: string; active: boolean }>;
  votesByPlayer: Record<string, string[]>;
  correctnessByPlayerSender: Record<string, Record<string, boolean>>;
  revealStep: number; // step3 triggers scale
}) {
  const senderMap = useMemo(() => new Map(props.senders.map(s => [s.id_local, s])), [props.senders]);

  return (
    <div className={styles.wrap}>
      {props.players.map((p) => {
        const votes = props.votesByPlayer[p.id] || [];
        const correctness = props.correctnessByPlayerSender[p.id] || {};
        return (
          <div key={p.id} className={styles.row}>
            <div className={styles.playerName}>{p.name}</div>
            <div className={styles.placards}>
              {votes.map((sid, idx) => {
                const ok = correctness[sid];
                const scale =
                  props.revealStep >= 3
                    ? ok ? styles.trueScale : styles.falseScale
                    : "";
                const name = senderMap.get(sid)?.name || sid;
                return (
                  <div key={`${sid}_${idx}`} className={`${styles.placard} ${scale}`}>
                    <SenderBadge senderId={sid} nameOverride={name} compact />
                    <div className={styles.tri} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
