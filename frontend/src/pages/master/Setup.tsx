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
import { applyMerge, buildModel, removeMerge, toggleSenderActive } from "../../lib/draftModel";
import { generateRoundsB } from "../../lib/roundGen";

function randomSeed(): string {
  const a = Math.random().toString(36).slice(2, 8);
  const b = Math.random().toString(36).slice(2, 8);
  return `${a}${b}`;
}

function newDraft(room_code: string): DraftV1 {
  return {
    v: 1,
    room_code,
    shares: [],
    import_reports: [],
    merge_map: {},
    active_map: {},
    name_overrides: {},
    seed: randomSeed(),
    k_max: 4,
    setup_sent_at: undefined,
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
        background: "rgba(0,0,0,1)",
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
        style={{
          width: "min(920px, 96vw)",
          maxHeight: "86vh",
          overflow: "auto",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <div className="h2" style={{ minWidth: 0 }}>
            {props.title}
          </div>
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

function splitName(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf(".");
  if (i <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, i), ext: name.slice(i) };
}

function makeUniqueFiles(files: File[]): File[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const n = f.name || "upload.json";
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }

  const seenIdx = new Map<string, number>();
  return files.map((f) => {
    const original = f.name || "upload.json";
    const total = counts.get(original) ?? 1;
    if (total <= 1) return f;

    const idx = (seenIdx.get(original) ?? 0) + 1;
    seenIdx.set(original, idx);

    const { base, ext } = splitName(original);
    const newName = `${base}_${idx}${ext}`;
    return new File([f], newName, { type: f.type, lastModified: f.lastModified });
  });
}

export default function MasterSetup() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);

  const [draft, setDraft] = useState<DraftV1 | null>(() => {
    if (!session) return null;
    const loaded = loadDraft(session.room_code) ?? newDraft(session.room_code);
    if (!loaded.seed || !loaded.seed.trim()) {
      const next = { ...loaded, seed: randomSeed(), updated_at: Date.now() };
      saveDraft(next);
      return next;
    }
    return loaded;
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const fileRef = useRef<HTMLInputElement | null>(null);
  const model = useMemo(() => (draft ? buildModel(draft) : null), [draft]);

  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<string[]>([]);

  const [rejModalOpen, setRejModalOpen] = useState(false);
  const [rejModalFile, setRejModalFile] = useState<string>("");

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const [previewN, setPreviewN] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);

  const persist = useCallback((next: DraftV1) => {
    saveDraft(next);
    setDraft(next);
  }, []);

  const locked = !!draft?.setup_sent_at;

  const onPickFiles = useCallback(() => fileRef.current?.click(), []);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!session || !draft) return;
      if (draft.setup_sent_at) return;
      if (!files || files.length === 0) return;

      setErr("");
      setBusy(true);
      try {
        const arr = makeUniqueFiles(Array.from(files));
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
    if (draft?.setup_sent_at) return;
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
  }, [draft, persist, session]);

  const deleteImportFile = useCallback(
    (fileName: string) => {
      if (!draft) return;
      if (draft.setup_sent_at) return;

      const next: DraftV1 = {
        ...draft,
        shares: draft.shares.filter((s) => (s.file_name ?? "") !== fileName),
        import_reports: draft.import_reports.filter((r) => r.file_name !== fileName),
        updated_at: Date.now(),
      };

      if (rejModalOpen && rejModalFile === fileName) {
        setRejModalOpen(false);
        setRejModalFile("");
      }

      persist(next);
    },
    [draft, persist, rejModalFile, rejModalOpen]
  );

  const toggleActive = useCallback(
    (sender_key: string, active: boolean) => {
      if (!draft) return;
      if (draft.setup_sent_at) return;
      persist(toggleSenderActive(draft, sender_key, active));
    },
    [draft, persist]
  );

  const doMerge = useCallback(
    (fromKey: string, intoKey: string) => {
      if (!draft) return;
      if (draft.setup_sent_at) return;
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
      if (draft.setup_sent_at) return;
      persist(removeMerge(draft, childKey));
    },
    [draft, persist]
  );

  const setSeed = useCallback(
    (seed: string) => {
      if (!draft) return;
      if (draft.setup_sent_at) return;
      persist({ ...draft, seed, updated_at: Date.now() });
    },
    [draft, persist]
  );

  const regenSeed = useCallback(() => {
    if (!draft) return;
    if (draft.setup_sent_at) return;
    persist({ ...draft, seed: randomSeed(), updated_at: Date.now() });
  }, [draft, persist]);

  const startRename = useCallback((sender_key: string, currentName: string) => {
    setEditingKey(sender_key);
    setEditingValue(currentName);
  }, []);

  const commitRename = useCallback(() => {
    if (!draft || !editingKey) return;
    if (draft.setup_sent_at) return;
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

    if (draft.setup_sent_at) {
      nav("/master/lobby");
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

      // lock local draft after successful upload
      const lockedDraft: DraftV1 = { ...draft, setup_sent_at: Date.now(), updated_at: Date.now() };
      persist(lockedDraft);

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

  const senders = model.senders;

  const previewRound =
    gen?.rounds?.[Math.max(0, Math.min((gen.rounds.length || 1) - 1, previewN - 1))] ?? null;

  const senderNameById = useMemo(() => {
    if (!gen) return {};
    const map: Record<string, string> = {};
    for (const s of gen.senders_payload) map[s.sender_id] = s.name;
    return map;
  }, [gen]);

  const importReportTop = draft.import_reports.slice(-20).reverse();

  const allRejectedForFile = (fileName: string) => {
    const reports = draft.import_reports.filter((r) => r.file_name === fileName);
    const out: string[] = [];
    for (const r of reports) for (const x of r.rejected_samples || []) out.push(x.sample);
    return out;
  };

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

  // --- STYLE HELPERS (no logic) ---
  const ellipsis1: React.CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const wrapAny: React.CSSProperties = {
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
  const rowNoOverflow: React.CSSProperties = { display: "flex", gap: 10, minWidth: 0 };
  const itemNoOverflow: React.CSSProperties = {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    justifyContent: "space-between",
    minWidth: 0,
    overflow: "hidden",
    flexWrap: "wrap",
  };
  const actionsNoOverflow: React.CSSProperties = {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    alignItems: "center",
    maxWidth: "100%",
  };

  return (
    <div className="card">
      <div className="h1">Master Setup</div>

      <div className="small">
        Room code: <span className="mono">{session.room_code}</span>
      </div>

      {locked ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(120,220,120,0.35)" }}>
          <div className="h2">Setup envoyé</div>
          <div className="small" style={{ marginTop: 6 }}>
            Imports / merges / toggles verrouillés.
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => nav("/master/lobby")}>
              Aller au Lobby
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}>
          {err}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", minWidth: 0 }}>
        {/* LEFT */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 1) Import */}
          <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
            <div className="h2">1) Import Instagram JSON</div>

            <div
              className="card"
              style={{
                marginTop: 10,
                borderStyle: "dashed",
                opacity: busy || locked ? 0.6 : 1,
                cursor: "pointer",
                overflow: "hidden",
              }}
              onClick={locked ? undefined : onPickFiles}
              onDrop={locked ? undefined : onDrop}
              onDragOver={locked ? undefined : onDragOver}
            >
              <div className="small" style={wrapAny}>
                Drag & drop 1+ exports Instagram (.json) ici, ou clique pour choisir.
              </div>
              <div className="small" style={{ marginTop: 6, ...wrapAny }}>
                Filtre strict: <span className="mono">instagram.com/reel/…</span> ou{" "}
                <span className="mono">/reels/…</span>
              </div>
            </div>

            <input
              ref={fileRef}
              type="file"
              multiple
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => onFiles(e.target.files)}
            />

            <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", minWidth: 0 }}>
              <button className="btn" disabled={busy || locked} onClick={onPickFiles}>
                Importer un fichier
              </button>
              <button className="btn" disabled={busy || locked} onClick={onResetDraft}>
                Reset draft
              </button>
            </div>

            {/* Import report */}
            <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
              <div className="h2">Imports</div>

              {importReportTop.length === 0 ? (
                <div className="small">—</div>
              ) : (
                <div className="list" style={{ marginTop: 8, overflow: "hidden" }}>
                  {importReportTop.map((r, idx) => {
                    const participants = (r.participants_detected || []).slice(0, 14);
                    const more = (r.participants_detected || []).length - participants.length;

                    return (
                      <div className="item" key={`${r.file_name}-${idx}`} style={itemNoOverflow}>
                        <div style={{ flex: "1 1 360px", minWidth: 0, overflow: "hidden" }}>
                          <div className="mono" style={ellipsis1} title={r.file_name}>
                            {r.file_name}
                          </div>

                          <div className="small" style={{ opacity: 0.9, ...wrapAny }}>
                            Participants:{" "}
                            <span className="mono" style={wrapAny}>
                              {participants.length ? participants.join(", ") : "—"}
                              {more > 0 ? ` (+${more})` : ""}
                            </span>
                          </div>

                          <div className="small" style={wrapAny}>
                            shares_added: <span className="mono">{r.shares_added}</span> — rejected:{" "}
                            <span className="mono">{r.rejected_count}</span>
                          </div>
                        </div>

                        <div style={actionsNoOverflow}>
                          <button
                            className="btn"
                            disabled={r.rejected_count === 0}
                            onClick={() => {
                              setRejModalFile(r.file_name);
                              setRejModalOpen(true);
                            }}
                          >
                            Voir les rejets
                          </button>

                          <button
                            className="btn"
                            onClick={() => deleteImportFile(r.file_name)}
                            title="Supprime cet import du draft (shares + report)"
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 2) Senders */}
          <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 12, minWidth: 0 }}>
              <div style={{ minWidth: 0 }}>
                <div className="h2">2) Senders</div>
                <div className="small">Rename inline + toggle active + défusionner.</div>
              </div>

              <button
                className="btn"
                onClick={() => {
                  setMergeSelected([]);
                  setMergeModalOpen(true);
                }}
                disabled={locked || model.senders.length < 2}
                style={{ flex: "0 0 auto", maxWidth: "100%" }}
              >
                Regrouper des senders
              </button>
            </div>

            <div className="list" style={{ marginTop: 10, overflow: "hidden" }}>
              {senders.length === 0 ? (
                <div className="small">Aucun sender.</div>
              ) : (
                senders.map((s) => (
                  <div className="item" key={s.sender_key} style={itemNoOverflow}>
                    <div style={{ flex: "1 1 420px", minWidth: 0, overflow: "hidden" }}>
                      {editingKey === s.sender_key ? (
                        <div style={{ ...rowNoOverflow, flexWrap: "wrap" }}>
                          <input
                            className="input"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              if (e.key === "Escape") cancelRename();
                            }}
                            autoFocus
                            style={{
                              flex: "1 1 240px",
                              minWidth: 160,
                              maxWidth: "100%",
                            }}
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
                          style={{ cursor: "text", ...ellipsis1 }}
                          title={s.name}
                          onClick={locked ? undefined : () => startRename(s.sender_key, s.name)}
                        >
                          {s.name}
                        </div>
                      )}

                      {s.merged_children.length ? (
                        <div className="small" style={{ marginTop: 6, opacity: 0.9, ...wrapAny }}>
                          Fusionnés ici:{" "}
                          <span style={wrapAny}>
                            {s.merged_children.map((c) => (
                              <span key={c} style={{ marginRight: 10, display: "inline-block" }}>
                                <span className="mono" style={wrapAny}>
                                  {c}
                                </span>{" "}
                                <button
                                  className="btn"
                                  style={{ padding: "2px 8px" }}
                                    onClick={locked ? undefined : () => doUnmerge(c)}
                                  title="Défusionner ce child"
                                    disabled={locked}
                                >
                                  défusionner
                                </button>
                              </span>
                            ))}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div style={actionsNoOverflow}>
                      <span className={s.reels_count > 0 ? "badge ok" : "badge bad"}>
                        reels: {s.reels_count}
                      </span>

                      <label className="row" style={{ gap: 6, flex: "0 0 auto" }}>
                        <input
                          type="checkbox"
                          checked={s.active}
                          onChange={(e) => toggleActive(s.sender_key, e.target.checked)}
                          disabled={locked}
                        />
                        <span className="small">active</span>
                      </label>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 3) Rounds */}
          <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
            <div className="h2">3) Génération des rounds</div>

            <div className="row" style={{ marginTop: 10, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label className="small" style={{ minWidth: 0 }}>
                seed{" "}
                <input
                  className="input"
                  value={draft.seed}
                  onChange={(e) => setSeed(e.target.value)}
                  disabled={locked}
                  style={{ width: 240, maxWidth: "100%" }}
                />
              </label>

              <button className="btn" onClick={regenSeed} disabled={busy || locked}>
                Seed aléatoire
              </button>
            </div>

            {!gen ? (
              <div className="small" style={{ marginTop: 10 }}>
                Importe des données pour générer.
              </div>
            ) : (
              <>
                <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
                  <button className="btn" onClick={() => setPreviewOpen((v) => !v)}>
                    {previewOpen ? "Masquer preview" : "Preview"}
                  </button>

                  <label className="small">
                    Round #
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={Math.max(1, gen.rounds.length)}
                      value={previewN}
                      onChange={(e) => setPreviewN(Number(e.target.value))}
                      style={{ width: 90, marginLeft: 8 }}
                    />
                  </label>
                </div>

                {previewOpen && previewRound ? (
                  <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
                    <div className="small" style={wrapAny}>
                      {previewRound.round_id} — items:{" "}
                      <span className="mono">{previewRound.items.length}</span>
                    </div>

                    <div className="list" style={{ marginTop: 8, overflow: "hidden" }}>
                      {previewRound.items.slice(0, 12).map((it) => (
                        <div className="item" key={it.item_id} style={itemNoOverflow}>
                          <div style={{ flex: "1 1 320px", minWidth: 0, overflow: "hidden" }}>
                            <div className="small mono" style={ellipsis1} title={it.item_id}>
                              {it.item_id}
                            </div>
                            <div className="small mono">k={it.k}</div>
                            <div className="small" style={{ ...wrapAny }}>
                              {it.reel.url}
                            </div>
                          </div>

                          <div className="small" style={{ flex: "1 1 240px", minWidth: 0, ...wrapAny }}>
                            true:{" "}
                            <span className="mono" style={wrapAny}>
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

        {/* RIGHT SIDEBAR */}
        <div style={{ width: 360, position: "sticky", top: 12, alignSelf: "flex-start", minWidth: 0 }}>
          <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
            <div className="h2">Métriques</div>

            <div className="small" style={{ marginTop: 10, lineHeight: 1.6, ...wrapAny }}>
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

            <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
              <div className="h2">Connecter les joueurs</div>
              <div className="small" style={wrapAny}>
                POST /room/:code/setup → puis Lobby.
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  disabled={busy || locked || !gen || gen.metrics.rounds_max <= 0}
                  onClick={connectPlayers}
                  style={{ maxWidth: "100%" }}
                >
                  {locked ? "Aller au Lobby" : busy ? "Envoi…" : "Connecter les joueurs"}
                </button>
              </div>

              {!gen || gen.metrics.rounds_max <= 0 ? (
                <div className="small" style={{ marginTop: 8, ...wrapAny }}>
                  Requis: au moins 2 senders actifs avec reels (sinon rounds_max=0).
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
          <div className="row" style={{ gap: 10, justifyContent: "space-between", minWidth: 0, flexWrap: "wrap" }}>
            <div className="small" style={{ minWidth: 0, ...wrapAny }}>
              Sélection:{" "}
              <span className="mono">{mergeSelected[0] ? nameForKey(mergeSelected[0]) : "—"}</span> +{" "}
              <span className="mono">{mergeSelected[1] ? nameForKey(mergeSelected[1]) : "—"}</span>
            </div>

            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <button
                className="btn"
                disabled={!mergeReady}
                onClick={() => {
                  if (!mergeReady) return;
                  doMerge(bKey, aKey);
                  setMergeModalOpen(false);
                  setMergeSelected([]);
                }}
              >
                Fusionner {mergeSelected[1] ? nameForKey(mergeSelected[1]) : "B"} →{" "}
                {mergeSelected[0] ? nameForKey(mergeSelected[0]) : "A"}
              </button>

              <button
                className="btn"
                disabled={!mergeReady}
                onClick={() => {
                  if (!mergeReady) return;
                  doMerge(aKey, bKey);
                  setMergeModalOpen(false);
                  setMergeSelected([]);
                }}
              >
                Fusionner {mergeSelected[0] ? nameForKey(mergeSelected[0]) : "A"} →{" "}
                {mergeSelected[1] ? nameForKey(mergeSelected[1]) : "B"}
              </button>
            </div>
          </div>
        }
      >
        <div className="small">Coche exactement 2 senders.</div>

        <div className="list" style={{ marginTop: 10, overflow: "hidden" }}>
          {mergeChoices.map((s) => {
            const checked = mergeSelected.includes(s.sender_key);
            return (
              <div className="item" key={s.sender_key} style={itemNoOverflow}>
                <div style={{ flex: "1 1 420px", minWidth: 0, overflow: "hidden" }}>
                  <div className="mono" style={ellipsis1} title={s.name}>
                    {s.name}
                  </div>
                  {s.merged_children.length ? (
                    <div className="small" style={{ marginTop: 6, opacity: 0.9, ...wrapAny }}>
                      Children: <span className="mono">{s.merged_children.join(", ")}</span>
                    </div>
                  ) : null}
                </div>

                <div style={actionsNoOverflow}>
                  <span className="badge ok">reels: {s.reels_count}</span>
                  <span className={s.active ? "badge ok" : "badge warn"}>{s.active ? "active" : "disabled"}</span>

                  <label className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setMergeSelected((prev) => {
                          if (on) {
                            if (prev.includes(s.sender_key)) return prev;
                            return [...prev, s.sender_key].slice(0, 2);
                          }
                          return prev.filter((x) => x !== s.sender_key);
                        });
                      }}
                    />
                    <span className="small">select</span>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Rejections Modal */}
      <Modal
        open={rejModalOpen}
        title={`Rejets — ${rejModalFile || ""}`}
        onClose={() => setRejModalOpen(false)}
      >
        {rejModalFile ? (
          (() => {
            const rej = allRejectedForFile(rejModalFile);
            if (rej.length === 0) return <div className="small">Aucun rejet.</div>;

            return (
              <div className="card" style={{ marginTop: 6, overflow: "hidden" }}>
                <div className="small" style={{ opacity: 0.9 }}>
                  Liens rejetés (liste brute) :
                </div>
                <div
                  className="mono"
                  style={{
                    marginTop: 10,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {rej.join("\n")}
                </div>
              </div>
            );
          })()
        ) : (
          <div className="small">—</div>
        )}
      </Modal>
    </div>
  );
}
