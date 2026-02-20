import React, { useMemo } from "react";
import { GameStateSync } from "../../../ws/gameClient";
import styles from "./ReelsPanel.module.css";
import ReelTile from "./ReelTile";

export default function ReelsPanel(props: {
  state: GameStateSync;
  revealStep: number;
  focusTruthSenderIds: string[];
  onOpen: () => void;
  onStartVoting: () => void;
  onStartTimer: () => void;
  onForceClose: () => void;
}) {
  const { state: st } = props;

  const items = st.round?.items || [];
  const focusIndex = st.current_item_index;

  const focusItem = items[focusIndex] || null;
  const miniItems = items.filter((_, i) => i !== focusIndex);

  const canOpen = !!st.focus_item && !st.focus_item.resolved && !!st.focus_item.reel_url;
  const canVote = !!st.focus_item && !st.focus_item.resolved;

  const slotsForFocus = useMemo(() => {
    const k = st.focus_item?.k || 0;
    const truth = props.revealStep >= 5 ? props.focusTruthSenderIds : [];
    return { k, truth };
  }, [st.focus_item?.k, props.revealStep, props.focusTruthSenderIds]);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.title}>Round</div>

        <div className={styles.controls}>
          <button className={styles.btn} disabled={!canOpen} onClick={props.onOpen}>
            Ouvrir
          </button>
          <button className={styles.btn} disabled={!canVote} onClick={props.onStartVoting}>
            Lancer le vote
          </button>
          <button className={styles.btn} disabled={!canVote} onClick={props.onStartTimer}>
            Lancer 10s
          </button>
          <button className={styles.btnSecondary} disabled={!canVote} onClick={props.onForceClose}>
            Fermer vote
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.focus}>
          <ReelTile
            mode="focus"
            k={slotsForFocus.k}
            resolved={!!focusItem?.resolved}
            opened={!!focusItem?.opened}
            isCurrent
            truthSenderIds={slotsForFocus.truth}
            revealStep={props.revealStep}
          />
        </div>

        <div className={styles.miniGrid}>
          {miniItems.map((it, idx) => (
            <ReelTile
              key={it.id}
              mode="mini"
              k={it.k}
              resolved={it.resolved}
              opened={it.opened}
              isCurrent={false}
              truthSenderIds={[]} // on n’affiche la truth que sur le focus (MVP UI)
              revealStep={0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
