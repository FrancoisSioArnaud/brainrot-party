import React, { useMemo } from "react";
import styles from "./RemainingSenders.module.css";
import SenderBadge from "./SenderBadge";

export default function RemainingSenders(props: {
  senders: Array<{ id_local: string; name: string; active: boolean; photo_url?: string | null }>;
  remainingIds: string[];
  highlightedTruth: Set<string>;
}) {
  const map = useMemo(() => new Map(props.senders.map(s => [s.id_local, s])), [props.senders]);

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>Senders restants</div>
      <div className={styles.row}>
        {props.remainingIds.map((id) => {
          const s = map.get(id);
          const highlight = props.highlightedTruth.has(id);
          if (!s) return null;
          return <SenderBadge key={id} senderId={id} nameOverride={s.name} highlight={highlight} />;
        })}
      </div>
    </div>
  );
}
