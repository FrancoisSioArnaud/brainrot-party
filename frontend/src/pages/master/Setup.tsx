import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDraftStore } from "../../store/draftStore";
import SpinnerOverlay from "../../components/common/SpinnerOverlay";
import { toast } from "../../components/common/Toast";
import styles from "./Setup.module.css";

import ImportSection from "../../components/master/setup/ImportSection";
import FusionSection from "../../components/master/setup/FusionSection";
import ActivationSection from "../../components/master/setup/ActivationSection";
import StatsPanel from "../../components/master/setup/StatsPanel";
import StickyPrimaryButton from "../../components/master/setup/StickyPrimaryButton";

async function openLobbyHttp(local_room_id?: string): Promise<{ join_code: string; master_key: string }> {
  const res = await fetch("/lobby/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ local_room_id })
  });
  if (!res.ok) throw new Error("open lobby failed");
  return await res.json();
}

async function closeLobbyHttp(join_code: string, master_key: string) {
  await fetch(`/lobby/${join_code}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ master_key, reason: "reset" })
  });
}

export default function MasterSetup() {
  const nav = useNavigate();

  const local_room_id = useDraftStore(s => s.local_room_id);
  const files = useDraftStore(s => s.files);
  const stats = useDraftStore(s => s.stats);
  const parsingBusy = useDraftStore(s => s.parsing_busy);

  const join_code = useDraftStore(s => s.join_code);
  const master_key = useDraftStore(s => s.master_key);

  const setJoin = useDraftStore(s => s.setJoin);
  const reset = useDraftStore(s => s.reset);

  const [busy, setBusy] = useState(false);

  const canConnect = useMemo(() => {
    return files.length >= 1 && (stats.active_senders || 0) >= 2;
  }, [files.length, stats.active_senders]);

  if (!local_room_id) {
    nav("/master", { replace: true });
    return null;
  }

  return (
    <div className={styles.grid}>
      <SpinnerOverlay open={busy || parsingBusy} text="J’en ai pour un instant…" />

      <div className={styles.left}>
        <div className={styles.section}>
          <ImportSection />
        </div>

        <div className={styles.section}>
          <FusionSection />
        </div>

        <div className={styles.section}>
          <ActivationSection />
        </div>

        <StickyPrimaryButton
          label="Connecter les joueurs"
          disabled={!canConnect || busy || parsingBusy}
          onClick={async () => {
            try {
              setBusy(true);
              const { join_code, master_key } = await openLobbyHttp(local_room_id);
              setJoin(join_code, master_key);
              nav("/master/lobby");
            } catch {
              toast("Impossible d’ouvrir le lobby");
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>

      <div className={styles.right}>
        <StatsPanel />
        <button
          className={styles.reset}
          disabled={busy || parsingBusy}
          onClick={async () => {
            if (!confirm("Réinitialiser ma room ?")) return;

            try {
              setBusy(true);
              if (join_code && master_key) {
                // purge lobby server-side + kick mobiles
                await closeLobbyHttp(join_code, master_key);
              }
            } catch {
              // ignore (reset local doit rester possible)
            } finally {
              reset();
              setBusy(false);
              nav("/master");
            }
          }}
        >
          Réinitialiser ma room
        </button>
      </div>
    </div>
  );
}
