import React from "react";
import { useParams } from "react-router-dom";
import styles from "./Wait.module.css";

export default function PlayWait() {
  const { joinCode } = useParams();
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Connecté</h1>
      <div className={styles.text}>Code: {joinCode}</div>
      <div className={styles.text}>Le jeu va bientôt commencer.</div>
      <div className={styles.note}>Cette page sera câblée avec rename/photo/change slot.</div>
    </div>
  );
}
