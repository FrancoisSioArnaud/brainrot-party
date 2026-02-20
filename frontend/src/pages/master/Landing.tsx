import React from "react";
import { useNavigate } from "react-router-dom";
import { useDraftStore } from "../../store/draftStore";
import styles from "./Landing.module.css";

export default function MasterLanding() {
  const nav = useNavigate();
  const create = useDraftStore(s => s.createLocalRoom);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Brainrot Party</h1>
      <button
        className={styles.primary}
        onClick={() => {
          create();
          nav("/master/setup");
        }}
      >
        Create room
      </button>
    </div>
  );
}
