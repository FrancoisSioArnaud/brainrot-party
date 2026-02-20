import React from "react";
import styles from "./SpinnerOverlay.module.css";

export default function SpinnerOverlay({ open, text }: { open: boolean; text?: string }) {
  if (!open) return null;
  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <div className={styles.spinner} />
        <div className={styles.text}>{text || "Chargement…"}</div>
      </div>
    </div>
  );
}
