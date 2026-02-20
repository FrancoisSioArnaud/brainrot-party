import React, { useMemo } from "react";
import styles from "./SenderBadge.module.css";

const PALETTE = ["p0","p1","p2","p3","p4","p5","p6","p7"];

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

export default function SenderBadge(props: {
  senderId: string;
  nameOverride?: string;
  highlight?: boolean;
  compact?: boolean;
}) {
  const colorClass = useMemo(() => {
    const idx = hashStr(props.senderId) % PALETTE.length;
    return PALETTE[idx];
  }, [props.senderId]);

  const name = props.nameOverride || props.senderId;

  return (
    <div
      className={[
        styles.wrap,
        styles[colorClass],
        props.highlight ? styles.highlight : "",
        props.compact ? styles.compact : "",
      ].join(" ")}
      title={name}
    >
      <div className={styles.avatar} />
      {!props.compact ? <div className={styles.name}>{name}</div> : null}
    </div>
  );
}
