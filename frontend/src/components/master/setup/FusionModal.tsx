import React, { useMemo, useState } from "react";
import Modal from "../../common/Modal";
import { DraftSender, useDraftStore } from "../../../store/draftStore";

function badgeLabel(badge: DraftSender["badge"]) {
  if (badge === "auto") return "Fusion Auto";
  if (badge === "manual") return "Fusion Manuelle";
  return "";
}

function provenanceText(s: DraftSender) {
  const occ = s.occurrences || [];
  if (occ.length === 0) return "—";
  return occ.map(o => `${o.participant_name} dans [${o.file_name}]`).join(" + ");
}

export default function FusionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const files = useDraftStore(s => s.files);
  const senders = useDraftStore(s => s.senders);
  const parsingBusy = useDraftStore(s => s.parsing_busy);
  const manualMerge = useDraftStore(s => s.manualMerge);
  const toggleAutoSplitByName = useDraftStore(s => s.toggleAutoSplitByName);

  const enabled = files.length >= 2;

  const rows = useMemo(() => {
    return senders
      .filter(s => !s.hidden)
      .slice()
      .sort((a, b) => b.reel_count_total - a.reel_count_total);
  }, [senders]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showMergeForm, setShowMergeForm] = useState(false);
  const [mergeName, setMergeName] = useState("");

  const selected = useMemo(() => {
    const set = new Set(selectedIds);
    return rows.filter(r => set.has(r.sender_id_local));
  }, [rows, selectedIds]);

  const canMerge = enabled && selected.length >= 2;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const resetMergeUi = () => {
    setSelectedIds([]);
    setShowMergeForm(false);
    setMergeName("");
  };

  return (
    <Modal
      open={open}
      title="Fusion des senders"
      onClose={() => {
        resetMergeUi();
        onClose();
      }}
    >
      {!enabled && (
        <div style={{ color: "var(--muted)", fontWeight: 800 }}>
          Ajoute au moins 2 fichiers pour activer la fusion.
        </div>
      )}

      {enabled && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: "var(--muted)", fontWeight: 800 }}>
              Sélectionne 2+ senders puis fusionne.
            </div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
              <button
                disabled={!canMerge || parsingBusy}
                style={{
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: canMerge ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                  color: "var(--text)",
                  fontWeight: 900
                }}
                onClick={() => {
                  setShowMergeForm(true);
                  setMergeName(selected[0]?.display_name || "");
                }}
              >
                Fusionner
              </button>

              <button
                disabled={selectedIds.length === 0 || parsingBusy}
                style={{
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text)",
                  fontWeight: 900
                }}
                onClick={resetMergeUi}
              >
                Reset sélection
              </button>
            </div>
          </div>

          {showMergeForm && (
            <div
              style={{
                marginTop: 12,
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: 12,
                background: "rgba(255,255,255,0.03)"
              }}
            >
              <div style={{ fontWeight: 1000, marginBottom: 8 }}>Fusion manuelle</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
                <input
                  value={mergeName}
                  onChange={(e) => setMergeName(e.target.value)}
                  placeholder="Nom du sender fusionné"
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--text)",
                    padding: "10px 12px",
                    fontWeight: 900
                  }}
                  disabled={parsingBusy}
                />
                <button
                  disabled={!canMerge || parsingBusy}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.08)",
                    color: "var(--text)",
                    fontWeight: 900
                  }}
                  onClick={() => {
                    manualMerge(selectedIds, mergeName);
                    resetMergeUi();
                  }}
                >
                  Confirmer
                </button>
              </div>

              <div style={{ color: "var(--muted)", fontWeight: 800, marginTop: 8 }}>
                Les senders sélectionnés seront masqués, et un nouveau sender “Fusion Manuelle” sera créé.
              </div>
            </div>
          )}

          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left" style={{ width: 40 }} />
                  <th align="left">Sender</th>
                  <th align="left">Provenance</th>
                  <th align="right">Reels</th>
                  <th align="left">Badge</th>
                  <th align="right">Actions</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((s) => {
                  const isManual = s.badge === "manual";
                  const selectable = !isManual; // MVP: évite de refusionner une fusion manuelle
                  const checked = selectedIds.includes(s.sender_id_local);
                  const isAuto = s.badge === "auto";

                  return (
                    <tr key={s.sender_id_local} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 0" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!selectable || parsingBusy}
                          onChange={() => toggleSelect(s.sender_id_local)}
                        />
                      </td>

                      <td style={{ padding: "8px 0", fontWeight: 1000 }}>{s.display_name}</td>

                      <td style={{ padding: "8px 0", color: "var(--muted)", fontWeight: 800 }}>
                        {provenanceText(s)}
                      </td>

                      <td align="right" style={{ padding: "8px 0", fontWeight: 900 }}>
                        {s.reel_count_total}
                      </td>

                      <td style={{ padding: "8px 0" }}>
                        {s.badge !== "none" && (
                          <span
                            style={{
                              fontSize: 12,
                              padding: "4px 8px",
                              borderRadius: 999,
                              border: "1px solid var(--border)",
                              background: "rgba(255,255,255,0.04)",
                              fontWeight: 900
                            }}
                          >
                            {badgeLabel(s.badge)}
                          </span>
                        )}
                      </td>

                      <td align="right" style={{ padding: "8px 0" }}>
                        {isAuto ? (
                          <button
                            disabled={parsingBusy}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 12,
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--text)",
                              fontWeight: 900
                            }}
                            onClick={() => {
                              // Défusionner (toggle): split par fichier. Re-cliquer => refusion auto.
                              toggleAutoSplitByName(s.display_name);
                              resetMergeUi();
                            }}
                          >
                            Défusionner
                          </button>
                        ) : (
                          <span style={{ color: "var(--muted)", fontWeight: 800 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
