import React, { useMemo } from "react";
import styles from "./ReelTile.module.css";
import SenderBadge from "./SenderBadge";

export default function ReelTile(props: {
  mode: "focus" | "mini";
  k: number;
  resolved: boolean;
  opened: boolean;
  isCurrent: boolean;
  truthSenderIds: string[]; // filled at step5
  revealStep: number;
}) {
  const { k, truthSenderIds } = props;

  const slots = useMemo(() => {
    const arr = Array.from({ length: Math.max(0, k) }).map((_, i) => truthSenderIds[i] || null);
    return arr;
  }, [k, truthSenderIds]);

  const stateLabel = props.resolved ? "Résolu" : props.opened ? "Ouvert" : "À ouvrir";

  return (
    <div
      className={`${styles.tile} ${props.mode === "focus" ? styles.focus : styles.mini} ${
        props.isCurrent ? styles.current : ""
      }`}
    >
      <div className={styles.top}>
        <div className={styles.badge}>{stateLabel}</div>
        {/* ✅ supprimé: k=... */}
      </div>

      <div className={styles.body}>
        <div className={styles.preview}>
          <div className={styles.previewInner} />
        </div>

        <div className={styles.slots}>
          {slots.map((sid, idx) => (
            <div key={idx} className={styles.slot}>
              {sid ? <SenderBadge senderId={sid} compact /> : <div className={styles.dotted} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
