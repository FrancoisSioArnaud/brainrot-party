import React from "react";
import styles from "./PlayerBadge.module.css";

export default function PlayerBadge(props: { name: string; score: number; inactive?: boolean }) {
  return (
    <div className={`${styles.wrap} ${props.inactive ? styles.inactive : ""}`}>
      <div className={styles.avatar} />
      <div className={styles.name}>{props.name}</div>
      <div className={styles.score}>{props.score}</div>
    </div>
  );
}
