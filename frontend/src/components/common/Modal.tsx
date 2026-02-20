import React from "react";
import styles from "./Modal.module.css";

export default function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>{title || ""}</div>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
