import React, { useMemo } from "react";
import { GameStateSync } from "../../../ws/gameClient";
import styles from "./ReelsPanel.module.css";
import ReelTile from "./ReelTile";

export default function ReelsPanel(props: {
  state: GameStateSync;
  revealStep: number;
  focusTruthSenderIds: string[];
  onOpen: () => void;
  onStartTimer: () => void;
  onForceClose: () => void;
}) {
  const { state: st } = props;

  const items = st.round?.items || [];
  const focusIndex = st.current_item_index;

  const focusItem = items[focusIndex] || null;
  const miniItems = items.filter((_, i) => i !== focusIndex);

  const phase = st.current_phase;

  const canOpen = !!st.focus_item && !st.focus_item.resolved && !!st.focus_item.reel_url;
  const canVoteActions = !!st.focus_item && !st.focus_item.resolved;

  const showOpen = phase === "ROUND_INIT" || phase === "OPEN_REEL";
  const showVoteActions = phase === "VOTING" || phase === "TIMER_RUNNING";

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
          {showOpen ? (
            <button className={styles.btn} disabled={!canOpen} onClick={props.onOpen}>
              Ouvrir
            </button>
          ) : null}

          {showVoteActions ? (
            <>
              <button className={styles.btn} disabled={!canVoteActions} onClick={props.onStartTimer}>
                Lancer 10s
              </button>
              <button className={styles.btnSecondary} disabled={!canVoteActions} onClick={props.onForceClose}>
                Fermer vote
              </button>
            </>
          ) : null}
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
          {miniItems.map((it) => (
            <ReelTile
              key={it.id}
              mode="mini"
              k={it.k}
              resolved={it.resolved}
              opened={it.opened}
              isCurrent={false}
              truthSenderIds={[]}
              revealStep={0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
