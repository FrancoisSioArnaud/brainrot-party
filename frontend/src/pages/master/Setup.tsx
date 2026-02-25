import React, { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PROTOCOL_VERSION } from "@brp/contracts";
import { uploadRoomSetup } from "../../lib/api";
import {
  clearDraft,
  clearMasterSession,
  loadDraft,
  loadMasterSession,
  saveDraft,
  type DraftV1,
} from "../../lib/storage";
import { importInstagramJsonFiles } from "../../lib/igImport";
import {
  applyMerge,
  buildModel,
  removeMerge,
  toggleSenderActive,
} from "../../lib/draftModel";
import { generateRoundsB } from "../../lib/roundGen";

function newDraft(room_code: string): DraftV1 {
  return {
    v: 1,
    room_code,
    shares: [],
    import_reports: [],
    merge_map: {},
    active_map: {},
    name_overrides: {},
    seed: "",
    k_max: 4,
    updated_at: Date.now(),
  };
}

function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,1)", // FULL OPACITY
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
      onMouseDown={props.onClose}
    >
      <div
        className="card"
        style={{ width: "min(920px, 96vw)", maxHeight: "86vh", overflow: "auto" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <div className="h2">{props.title}</div>
          <button className="btn" onClick={props.onClose}>
            Fermer
          </button>
        </div>

        <div style={{ marginTop: 10 }}>{props.children}</div>

        {props.footer ? <div style={{ marginTop: 12 }}>{props.footer}</div> : null}
      </div>
    </div>
  );
}

export default function MasterSetup() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);

  const [draft, setDraft] = useState<DraftV1 | null>(() => {
    if (!session) return null;
    return loadDraft(session.room_code) ?? newDraft(session.room_code);
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const fileRef = useRef<HTMLInputElement | null>(null);
  const model = useMemo(() => (draft ? buildModel(draft) : null), [draft]);

  // Merge modal state
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<string[]>([]); // root sender_key (max 2)

  // Rejections modal state
  const [rejModalOpen, setRejModalOpen] = useState(false);
  const [rejModalFile, setRejModalFile] = useState<string>("");

  // Inline rename state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  // preview UI
  const [previewN, setPreviewN] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);

  const persist = useCallback((next: DraftV1) => {
    saveDraft(next);
    setDraft(next);
  }, []);

  const onPickFiles = useCallback(() => fileRef.current?.click(), []);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!session || !draft) return;
      if (!files || files.length === 0) return;

      setErr("");
      setBusy(true);
      try {
        const arr = Array.from(files);
        const res = await importInstagramJsonFiles(arr);

        const next: DraftV1 = {
          ...draft,
          shares: [
            ...draft.shares,
            ...res.shares.map((s) => ({
              url: s.url,
              sender_name: s.sender_name,
              file_name: s.file_name,
            })),
          ],
          import_reports: [
            ...draft.import_reports,
            ...res.by_file.map((r) => ({
              file_name: r.file_name,
              shares_added: r.shares_added,
              rejected_count: r.rejected_count,
              rejected_samples: r.rejected_samples,
              participants_detected: r.participants_detected || [],
            })),
          ],
          updated_at: Date.now(),
        };

        persist(next);
      } catch (e: unknown) {
        setErr(String((e as any)?.message ?? "Import failed"));
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [draft, persist, session]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      await onFiles(e.dataTransfer.files);
    },
    [onFiles]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onResetDraft = useCallback(() => {
    if (!session) return;
    clearDraft(session.room_code);
    const d = newDraft(session.room_code);
    persist(d);
    setErr("");
    setMergeSelected([]);
    setMergeModalOpen(false);
    setRejModalOpen(false);
    setRejModalFile("");
    setEditingKey(null);
    setEditingValue("");
    setPreviewN(1);
    setPreviewOpen(false);
  }, [persist, session]);

  const toggleActive = useCallback(
    (sender_key: string, active: boolean) => {
      if (!draft) return;

      // Auto-disable: impossible d'activer un sender sans reel
      const s = model?.senders.find((x) => x.sender_key === sender_key);
      if (active && s && s.reels_count <= 0) {
        setErr("Ce sender n'a aucun reel. Il est automatiquement désactivé.");
        return;
      }

      setErr("");
      persist(toggleSenderActive(draft, sender_key, active));
    },
    [draft, model, persist]
  );

  const doMerge = useCallback(
    (fromKey: string, intoKey: string) => {
      if (!draft) return;
      const next = applyMerge(draft, fromKey, intoKey);
      if (next === draft) {
        setErr("Merge invalide (boucle ou keys invalides).");
        return;
      }
      persist(next);
      setErr("");
    },
    [draft, persist]
  );

  const doUnmerge = useCallback(
    (childKey: string) => {
      if (!draft) return;
      persist(removeMerge(draft, childKey));
    },
    [draft, persist]
  );

  const setSeed = useCallback(
    (seed: string) => {
      if (!draft) return;
      persist({ ...draft, seed, updated_at: Date.now() });
    },
    [draft, persist]
  );

  const setKmax = useCallback(
    (k_max: number) => {
      if (!draft) return;
      const km = Math.max(1, Math.min(8, Math.floor(k_max)));
      persist({ ...draft, k_max: km, updated_at: Date.now() });
    },
    [draft, persist]
  );

  const startRename = useCallback((sender_key: string, currentName: string) => {
    setEditingKey(sender_key);
    setEditingValue(currentName);
  }, []);

  const commitRename = useCallback(() => {
    if (!draft || !editingKey) return;
    const val = editingValue.trim();

    const name_overrides = { ...(draft.name_overrides || {}) };
    if (!val) delete name_overrides[editingKey];
    else name_overrides[editingKey] = val;

    persist({ ...draft, name_overrides, updated_at: Date.now() });
    setEditingKey(null);
    setEditingValue("");
  }, [draft, editingKey, editingValue, persist]);

  const cancelRename = useCallback(() => {
    setEditingKey(null);
    setEditingValue("");
  }, []);

  const gen = useMemo(() => {
    if (!session || !draft || !model) return null;
    return generateRoundsB({
      room_code: session.room_code,
      seed: draft.seed,
      k_max: draft.k_max,
      items: model.items,
      senders: model.senders,
    });
  }, [draft, model, session]);

  const connectPlayers = useCallback(async () => {
    if (!session || !draft || !model || !gen) {
      setErr("Pas de session master / draft.");
      return;
    }

    setErr("");
    setBusy(true);
    try {
      if (gen.metrics.rounds_max <= 0) {
        throw new Error("validation_error: rounds_max=0 (il faut au moins 2 senders actifs avec des reels)");
      }

      await uploadRoomSetup(session.room_code, session.master_key, {
        protocol_version: PROTOCOL_VERSION,
        seed: draft.seed,
        k_max: draft.k_max,
        senders: gen.senders_payload,
        rounds: gen.rounds,
        round_order: gen.round_order,
        metrics: {
          ...gen.metrics,
          ...gen.debug,
          draft_updated_at: draft.updated_at,
          files_count: model.stats.files_count,
          shares_total: model.stats.shares_total,
          urls_unique: model.stats.urls_unique,
          urls_multi_sender: model.stats.urls_multi_sender,
          senders_total: model.stats.senders_total,
          senders_active: model.stats.senders_active,
          reels_min: model.stats.reels_min,
          reels_median: model.stats.reels_median,
          reels_max: model.stats.reels_max,
        },
      });

      nav("/master/lobby");
    } catch (e: any) {
      const msg = String(e?.message ?? "upload failed");

      if (msg.startsWith("room_expired") || msg.startsWith("room_not_found")) {
        clearMasterSession();
        nav("/?err=room_expired", { replace: true });
        return;
      }

      setErr(msg);
    } finally {
      setBusy(false);
    }
  }, [draft, gen, model, nav, session]);

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Setup</div>
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          Pas de session master. Reviens sur la landing et “Créer une partie”.
        </div>
      </div>
    );
  }

  if (!draft || !model) {
    return (
      <div className="card">
        <div className="h1">Setup</div>
        <div className="small">Chargement…</div>
      </div>
    );
  }

  // No search/sort UI: keep model.senders order (automatic)
  const senders = model.senders;

  // Preview
  const previewRound =
    gen?.rounds?.[
      Math.max(0, Math.min((gen.rounds.length || 1) - 1, previewN - 1))
    ] ?? null;

  const senderNameById = useMemo(() => {
    if (!gen) return {};
    const map: Record<string, string> = {};
    for (const s of gen.senders_payload) map[s.sender_id] = s.name;
    return map;
  }, [gen]);

  // Import report
  const importReportTop = draft.import_reports.slice(-10).reverse();

  const allRejectedForFile = (fileName: string) => {
    const reports = draft.import_reports.filter((r) => r.file_name === fileName);
    const out: string[] = [];
    for (const r of reports) {
      for (const x of r.rejected_samples || []) out.push(x.sample);
    }
    return out;
  };

  // Merge modal choices: keep automatic ordering too
  const mergeChoices = model.senders.map((s) => ({
    sender_key: s.sender_key,
    name: s.name,
    reels_count: s.reels_count,
    active: s.active,
    merged_children: s.merged_children,
  }));

  const mergeReady = mergeSelected.length === 2;
  const aKey = mergeSelected[0] ?? "";
  const bKey = mergeSelected[1] ?? "";

  const nameForKey = (k: string) => mergeChoices.find((x) => x.sender_key === k)?.name ?? k;

  return (
    <div className="card">
      <div className="h1">Master Setup</div>

      <div className="small">
        Room code: <span className="mono">{session.room_code}</span>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>

      {/* 1) Import */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">1) Import Instagram JSON</div>

        <div
          className="card"
          style={{
            marginTop: 10,
            borderStyle: "dashed",
            opacity: busy ? 0.6 : 1,
            cursor: "pointer",
          }}
          onClick={onPickFiles}
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <div className="small">
            Drag & drop 1+ exports Instagram (.json) ici, ou clique pour choisir.
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            Filtre strict: <span className="mono">instagram.com/reel/…</span> ou{" "}
            <span className="mono">/reels/…</span>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          multiple
          style={{ display: "none" }}
          onChange={(e) => onFiles(e.target.files)}
        />

        <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
          <span className="badge ok">files: {model.stats.files_count}</span>
          <span className="badge ok">shares: {model.stats.shares_total}</span>
          <span className="badge ok">urls_unique: {model.stats.urls_unique}</span>
          <span className="badge ok">urls_multi: {model.stats.urls_multi_sender}</span>
        </div>

        {importReportTop.length ? (
          <div style={{ marginTop: 12 }}>
            <div className="small" style={{ opacity: 0.9 }}>
              Derniers imports
            </div>

            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {importReportTop.map((r, idx) => (
                <div key={`${r.file_name}-${idx}`} className="card">
                  <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div className="mono">{r.file_name}</div>
                      {r.participants_detected?.length ? (
                        <div className="small" style={{ marginTop: 4, opacity: 0.9 }}>
                          participants:{" "}
                          <span className="mono">{r.participants_detected.join(", ")}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      <span className="badge ok">+{r.shares_added}</span>
                      <button
                        className="btn"
                        onClick={() => {
                          setRejModalFile(r.file_name);
                          setRejModalOpen(true);
                        }}
                        disabled={!r.rejected_count}
                        title="Voir les rejets"
                      >
                        Voir les rejets ({r.rejected_count})
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 12, gap: 10 }}>
          <button className="btn" onClick={onResetDraft} disabled={busy}>
            Reset draft
          </button>
        </div>
      </div>

      {/* 2) Senders */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="h2">2) Senders</div>
            <div className="small">Renommer, activer/désactiver, regrouper, défusionner.</div>
          </div>

          <button className="btn" onClick={() => setMergeModalOpen(true)} disabled={busy}>
            Regrouper des senders
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {senders.length === 0 ? (
            <div className="small">Aucun sender (importe des fichiers).</div>
          ) : (
            senders.map((s) => (
              <div key={s.sender_key} className="card">
                <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    {editingKey === s.sender_key ? (
                      <div className="row" style={{ gap: 8 }}>
                        <input
                          className="input"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          style={{ width: "min(420px, 70vw)" }}
                          autoFocus
                        />
                        <button className="btn" onClick={commitRename}>
                          OK
                        </button>
                        <button className="btn" onClick={cancelRename}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div
                        className="mono"
                        style={{ cursor: "text" }}
                        title="Clique pour renommer"
                        onClick={() => startRename(s.sender_key, s.name)}
                      >
                        {s.name}
                      </div>
                    )}

                    {/* Défusions (children) */}
                    {s.merged_children.length ? (
                      <div className="small" style={{ marginTop: 6, opacity: 0.9 }}>
                        Fusionnés ici:{" "}
                        {s.merged_children.map((c) => (
                          <span key={c} style={{ marginRight: 10 }}>
                            <span className="mono">{c}</span>{" "}
                            <button
                              className="btn"
                              style={{ padding: "2px 8px" }}
                              onClick={() => doUnmerge(c)}
                              title="Défusionner ce child"
                            >
                              défusionner
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="row" style={{ gap: 12 }}>
                    {s.reels_count > 0 ? (
                      <span className="badge ok">reels: {s.reels_count}</span>
                    ) : (
                      <span className="badge bad">reels: 0</span>
                    )}

                    <label className="row" style={{ gap: 6, opacity: s.reels_count <= 0 ? 0.6 : 1 }}>
                      <input
                        type="checkbox"
                        checked={s.active}
                        disabled={s.reels_count <= 0}
                        onChange={(e) => toggleActive(s.sender_key, e.target.checked)}
                      />
                      <span className="small">active</span>
                    </label>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 3) Rounds */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">3) Rounds (Spec v3)</div>

        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <label className="small">
            seed{" "}
            <input
              className="input"
              value={draft.seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="(optional)"
              style={{ width: 220 }}
            />
          </label>

          <label className="small">
            k_max{" "}
            <input
              className="input"
              type="number"
              min={1}
              max={8}
              value={draft.k_max}
              onChange={(e) => setKmax(Number(e.target.value))}
              style={{ width: 90 }}
            />
          </label>
        </div>

        {!gen ? (
          <div className="small" style={{ marginTop: 10 }}>
            Importe des données pour générer.
          </div>
        ) : (
          <>
            <div className="small" style={{ marginTop: 10 }}>
              Active senders: <span className="mono">{gen.metrics.active_senders}</span> — rounds_max:{" "}
              <span className="mono">{gen.metrics.rounds_max}</span> — rounds_complete:{" "}
              <span className="mono">{gen.metrics.rounds_complete}</span> — items_total:{" "}
              <span className="mono">{gen.metrics.items_total}</span> — unused_urls:{" "}
              <span className="mono">{gen.debug.unused_urls}</span>
            </div>

            <div className="row" style={{ marginTop: 10, gap: 10 }}>
              <button className="btn" onClick={() => setPreviewOpen((x) => !x)}>
                {previewOpen ? "Masquer preview" : "Preview round"}
              </button>

              <label className="small">
                N{" "}
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={Math.max(1, gen.rounds.length)}
                  value={previewN}
                  onChange={(e) => setPreviewN(Number(e.target.value))}
                  style={{ width: 90 }}
                />
              </label>
            </div>

            {previewOpen && previewRound ? (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="small">
                  {previewRound.round_id} — items:{" "}
                  <span className="mono">{previewRound.items.length}</span>
                </div>

                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {previewRound.items.map((it) => (
                    <div key={it.item_id} className="card">
                      <div className="small">
                        k=<span className="mono">{it.k}</span> —{" "}
                        <span className="mono">{it.reel.url}</span>
                      </div>
                      <div className="small" style={{ marginTop: 6 }}>
                        true senders:{" "}
                        <span className="mono">
                          {it.true_sender_ids.map((id) => senderNameById[id] ?? id).join(", ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

        </div>

        <div style={{ width: 360, position: "sticky", top: 12, alignSelf: "flex-start" }}>
          <div className="card">
            <div className="h2">Métriques</div>

            <div className="small" style={{ marginTop: 10, lineHeight: 1.6 }}>
              <div>
                files: <span className="mono">{model.stats.files_count}</span>
              </div>
              <div>
                shares: <span className="mono">{model.stats.shares_total}</span>
              </div>
              <div>
                urls_unique: <span className="mono">{model.stats.urls_unique}</span>
              </div>
              <div>
                urls_multi: <span className="mono">{model.stats.urls_multi_sender}</span>
              </div>
              <div>
                senders_total: <span className="mono">{model.stats.senders_total}</span>
              </div>
              <div>
                senders_active: <span className="mono">{model.stats.senders_active}</span>
              </div>
              <div>
                reels_min/med/max: <span className="mono">{model.stats.reels_min}</span> /{" "}
                <span className="mono">{model.stats.reels_median}</span> /{" "}
                <span className="mono">{model.stats.reels_max}</span>
              </div>

              <hr style={{ opacity: 0.25, margin: "10px 0" }} />

              {!gen ? (
                <div className="small">Importe des données pour générer les rounds.</div>
              ) : (
                <>
                  <div>
                    active_senders: <span className="mono">{gen.metrics.active_senders}</span>
                  </div>
                  <div>
                    rounds_generated: <span className="mono">{gen.metrics.rounds_generated}</span>
                  </div>
                  <div>
                    items_total: <span className="mono">{gen.metrics.items_total}</span>
                  </div>
                  <div>
                    items_multi/mono: <span className="mono">{gen.metrics.items_multi}</span> /{" "}
                    <span className="mono">{gen.metrics.items_mono}</span>
                  </div>
                  <div>
                    items_used: <span className="mono">{gen.metrics.items_used}</span>
                  </div>
                  <div>
                    senders_dropped: <span className="mono">{gen.metrics.senders_dropped_total}</span>
                  </div>
                  <div>
                    unused_urls: <span className="mono">{gen.debug.unused_urls}</span>
                  </div>
                </>
              )}
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="h2">Connecter les joueurs</div>
              <div className="small">POST /room/:code/setup → puis Lobby.</div>

              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  disabled={busy || !gen || gen.metrics.rounds_generated <= 0}
                  onClick={connectPlayers}
                >
                  {busy ? "Envoi…" : "Connecter les joueurs"}
                </button>
              </div>

              {!gen || gen.metrics.rounds_generated <= 0 ? (
                <div className="small" style={{ marginTop: 8 }}>
                  Requis: au moins 2 senders actifs avec reels (sinon 0 round).
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Merge Modal */}
      <Modal
        open={mergeModalOpen}
        title="Regrouper des senders"
        onClose={() => setMergeModalOpen(false)}
        footer={
          <div className="row" style={{ gap: 10, justifyContent: "space-between" }}>
            <div className="small">
              Sélectionne 2 senders puis clique sur “Fusionner”.
            </div>
            <div className="row" style={{ gap: 10 }}>
              <button
                className="btn"
                disabled={!mergeReady}
                onClick={() => {
                  if (!mergeReady) return;
                  doMerge(aKey, bKey);
                  setMergeSelected([]);
                  setMergeModalOpen(false);
                }}
              >
                Fusionner
              </button>
            </div>
          </div>
        }
      >
        <div className="small" style={{ marginBottom: 10 }}>
          Sélection :{" "}
          <span className="mono">
            {mergeSelected.map((k) => nameForKey(k)).join(" + ") || "(rien)"}
          </span>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {mergeChoices.map((c) => {
            const checked = mergeSelected.includes(c.sender_key);
            const disabled = !checked && mergeSelected.length >= 2;
            return (
              <label
                key={c.sender_key}
                className="card"
                style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setMergeSelected((prev) => {
                      const p = prev.slice();
                      const idx = p.indexOf(c.sender_key);
                      if (on && idx === -1) p.push(c.sender_key);
                      if (!on && idx !== -1) p.splice(idx, 1);
                      return p.slice(0, 2);
                    });
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div className="mono">{c.name}</div>
                  <div className="small" style={{ opacity: 0.9, marginTop: 4 }}>
                    reels: <span className="mono">{c.reels_count}</span> —{" "}
                    <span className="mono">{c.active ? "active" : "inactive"}</span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Modal>

      {/* Rejections Modal */}
      <Modal
        open={rejModalOpen}
        title={`Rejets — ${rejModalFile}`}
        onClose={() => setRejModalOpen(false)}
      >
        <div className="small">
          {allRejectedForFile(rejModalFile).length === 0 ? (
            <div className="small">Aucun rejet.</div>
          ) : (
            <div className="card" style={{ marginTop: 10 }}>
              {allRejectedForFile(rejModalFile).map((x, idx) => (
                <div key={`${idx}-${x}`} className="mono" style={{ padding: "4px 0" }}>
                  {x}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
