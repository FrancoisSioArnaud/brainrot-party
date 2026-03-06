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
    date_range: {},
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
        background: "rgba(0,0,0,0.98)",
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

function makeUniqueFiles(files: File[], reservedNames: Set<string>): File[] {
  const used = new Set<string>();

  const uniqueName = (original: string): string => {
    const baseName = original || "upload.json";
    if (!reservedNames.has(baseName) && !used.has(baseName)) return baseName;

    const { base, ext } = splitName(baseName);
    let i = 1;
    while (true) {
      const candidate = `${base}_${i}${ext}`;
      if (!reservedNames.has(candidate) && !used.has(candidate)) return candidate;
      i += 1;
    }
  };

  return files.map((f) => {
    const original = f.name || "upload.json";
    const name = uniqueName(original);
    used.add(name);
    reservedNames.add(name);
    if (name === original) return f;
    return new File([f], name, { type: f.type, lastModified: f.lastModified });
  });
}

function toDayStartMs(date: string): number | undefined {
  if (!date) return undefined;
  const ms = Date.parse(`${date}T00:00:00`);
  return Number.isFinite(ms) ? ms : undefined;
}

function toDayEndMs(date: string): number | undefined {
  if (!date) return undefined;
  const ms = Date.parse(`${date}T23:59:59.999`);
  return Number.isFinite(ms) ? ms : undefined;
}

function formatDateRangeLabel(from?: string, to?: string): string {
  if (from && to) return `${from} → ${to}`;
  if (from) return `À partir du ${from}`;
  if (to) return `Jusqu'au ${to}`;
  return "Aucune plage active";
}

function formatTimestampMs(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "Date inconnue";
  try {
    return new Date(ms).toLocaleString("fr-FR");
  } catch {
    return "Date inconnue";
  }
}

function EditIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        width: 16,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.8,
        fontSize: 13,
      }}
    >
      ✎
    </span>
  );
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
    if (!loaded.date_range) {
      const next = { ...loaded, date_range: {}, updated_at: Date.now() };
      saveDraft(next);
      return next;
    }
    return loaded;
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const locked = !!draft?.setup_sent_at;

  const fileRef = useRef<HTMLInputElement | null>(null);

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

  const onPickFiles = useCallback(() => fileRef.current?.click(), []);

  const filteredShares = useMemo(() => {
    if (!draft) return [];
    const fromMs = toDayStartMs(draft.date_range?.from_date ?? "");
    const toMs = toDayEndMs(draft.date_range?.to_date ?? "");
    return draft.shares.filter((share) => {
      if (typeof share.timestamp_ms !== "number") return true;
      if (typeof fromMs === "number" && share.timestamp_ms < fromMs) return false;
      if (typeof toMs === "number" && share.timestamp_ms > toMs) return false;
      return true;
    });
  }, [draft]);

  const draftForModel = useMemo(() => {
    if (!draft) return null;
    return {
      ...draft,
      shares: filteredShares,
    };
  }, [draft, filteredShares]);

  const model = useMemo(() => (draftForModel ? buildModel(draftForModel) : null), [draftForModel]);

  const activeSenderKeys = useMemo(() => {
    const out = new Set<string>();
    for (const sender of model?.senders ?? []) {
      if (sender.active && sender.reels_count > 0) out.add(sender.sender_key);
    }
    return out;
  }, [model]);

  const activeOnlyItems = useMemo(() => {
    return (model?.items ?? []).filter((item) => item.true_sender_keys.some((k) => activeSenderKeys.has(k)));
  }, [activeSenderKeys, model]);

  const activeOnlyUrlsMultiSender = useMemo(
    () => activeOnlyItems.filter((item) => item.true_sender_keys.filter((k) => activeSenderKeys.has(k)).length > 1).length,
    [activeOnlyItems, activeSenderKeys]
  );

  const filteredSharesWithKnownDateCount = useMemo(
    () => filteredShares.filter((share) => typeof share.timestamp_ms === "number").length,
    [filteredShares]
  );

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!session || !draft) return;
      if (draft.setup_sent_at) return;
      if (!files || files.length === 0) return;

      setErr("");
      setBusy(true);
      try {
        const reserved = new Set<string>();
        for (const r of draft.import_reports) reserved.add(r.file_name);
        for (const s of draft.shares) if (s.file_name) reserved.add(s.file_name);
        const arr = makeUniqueFiles(Array.from(files), reserved);
        const res = await importInstagramJsonFiles(arr);

        const next: DraftV1 = {
          ...draft,
          shares: [
            ...draft.shares,
            ...res.shares.map((s) => ({
              url: s.url,
              sender_name: s.sender_name,
              file_name: s.file_name,
              timestamp_ms: s.timestamp_ms,
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
  }, [draft?.setup_sent_at, persist, session]);

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

  const handleSenderRowClick = useCallback(
    (sender_key: string, active: boolean) => {
      if (!draft || draft.setup_sent_at) return;
      if (editingKey === sender_key) return;
      toggleActive(sender_key, !active);
    },
    [draft, editingKey, toggleActive]
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

  const setDateRange = useCallback(
    (patch: { from_date?: string; to_date?: string }) => {
      if (!draft) return;
      if (draft.setup_sent_at) return;
      const nextFrom = patch.from_date ?? draft.date_range?.from_date ?? "";
      const nextTo = patch.to_date ?? draft.date_range?.to_date ?? "";
      if (nextFrom && nextTo && nextFrom > nextTo) {
        setErr("La date de début doit être antérieure ou égale à la date de fin.");
        return;
      }
      setErr("");
      persist({
        ...draft,
        date_range: {
          from_date: nextFrom || undefined,
          to_date: nextTo || undefined,
        },
        updated_at: Date.now(),
      });
    },
    [draft, persist]
  );

  const clearDateRange = useCallback(() => {
    if (!draft) return;
    if (draft.setup_sent_at) return;
    setErr("");
    persist({
      ...draft,
      date_range: {},
      updated_at: Date.now(),
    });
  }, [draft, persist]);

  const startRename = useCallback(
    (sender_key: string, currentName: string) => {
      if (draft?.setup_sent_at) return;
      setEditingKey(sender_key);
      setEditingValue(currentName);
    },
    [draft?.setup_sent_at]
  );

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
        throw new Error("validation_error: rounds_max=0 (il faut au moins 2 participants actifs pour ouvrir ta partie)");
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
          date_range_from: draft.date_range?.from_date ?? null,
          date_range_to: draft.date_range?.to_date ?? null,
        },
      });

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
  }, [draft, gen, model, nav, persist, session]);

  if (!session) {
    return (
      <div className="card">
        <div className="h1">Paramètre ta partie</div>
        <div className="card" style={{ borderColor: "rgba(255,80,80,0.5)" }}>
          Pas de partie. Crées-en une nouvelle.
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
  const previewRound = gen?.rounds?.[Math.max(0, Math.min((gen.rounds.length || 1) - 1, previewN - 1))] ?? null;

  const senderNameById: Record<string, string> = {};
  for (const s of gen?.senders_payload ?? []) senderNameById[s.sender_id] = s.name;

  const importReportTop = draft.import_reports.slice(-20).reverse();
  const hasAnyImportedFiles = model.stats.files_count > 0;

  const allRejectedForFile = (fileName: string) => {
    const reports = draft.import_reports.filter((r) => r.file_name === fileName);
    const out: string[] = [];
    for (const r of reports) {
      for (const x of r.rejected_samples || []) out.push(x.sample);
    }
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
    flexWrap: "wrap",
  };
  const actionsNoOverflow: React.CSSProperties = {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    maxWidth: "100%",
    flexDirection: "row",
    flex: "1 1",
    justifyContent: "space-between",
  };

  return (
    <div className="card">
      <div className="h1">Paramètrage de la partie</div>

      {locked ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(120,255,120,0.25)" }}>
          <div className="h2">Setup envoyé</div>
          <div className="small" style={{ marginTop: 6 }}>
            Ce draft est verrouillé tant que la room est active.
          </div>
          <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
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

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", minWidth: 0, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card" style={{ marginTop: 8 }}>
            <div className="h2">Imports instagram</div>
            <div className="small">Importe tes conversations Instagram sous forme de fichiers JSON.</div>
            <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", minWidth: 0 }}>
              <div
                className={`${hasAnyImportedFiles ? "card item btnSecondary" : "card item btnPrimary"}`}
                style={{
                  marginTop: 10,
                  borderStyle: "dashed",
                  opacity: busy || locked ? 0.6 : 1,
                  cursor: busy || locked ? "default" : "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: 40,
                  width: "100%",
                }}
                onClick={locked ? undefined : onPickFiles}
                onDrop={onDrop}
                onDragOver={onDragOver}
              >
                <div className="small" style={wrapAny}>
                  Clic ou drag & drop un export Instagram (.json)
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

              {importReportTop.length !== 0 ? (
                <div className="list" style={{ width: "100%", marginTop: 10, display: "grid", gap: 10 }}>
                  {importReportTop.map((r, idx) => {
                    const participants = (r.participants_detected || []).slice(0, 14);
                    const more = (r.participants_detected || []).length - participants.length;

                    return (
                      <div className="item" key={`${r.file_name}-${idx}`} style={itemNoOverflow}>
                        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
                          <div className="mono" style={{ marginBottom: 12, ...ellipsis1 }} title={r.file_name}>
                            {r.file_name}
                          </div>

                          <div className="small" style={{ opacity: 0.9, ...wrapAny }}>
                            Participants :{" "}
                            <span className="mono" style={wrapAny}>
                              {participants.length ? participants.join(", ") : "—"}
                              {more > 0 ? ` (+${more})` : ""}
                            </span>
                          </div>

                          <div className="small" style={wrapAny}>
                            <span className="mono">{r.shares_added} liens ajoutés</span> —{" "}
                            <span className="mono">{r.rejected_count} liens rejetés</span>
                          </div>
                        </div>

                        <div style={actionsNoOverflow}>
                          <button
                            className="btn"
                            disabled={locked || r.rejected_count === 0}
                            onClick={() => {
                              setRejModalFile(r.file_name);
                              setRejModalOpen(true);
                            }}
                          >
                            Voir les rejets
                          </button>

                          <button
                            className="btn btnDanger"
                            disabled={locked}
                            onClick={() => deleteImportFile(r.file_name)}
                            title="Supprime cet import du draft"
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="row" style={{ width: "100%", gap: 10, flexWrap: "wrap" }}>
                <button className="btn" disabled={locked} onClick={onPickFiles}>
                  Importer un fichier
                </button>
                <button className="btn btnDanger" disabled={locked} onClick={onResetDraft}>
                  Reset draft
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div className="h2">Plage de temps</div>
                <div className="small">Filtre les liens importés par date quand la date est disponible dans les exports.</div>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="small">Du</span>
                <input
                  className="input"
                  type="date"
                  value={draft.date_range?.from_date ?? ""}
                  disabled={locked}
                  onChange={(e) => setDateRange({ from_date: e.target.value })}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="small">Au</span>
                <input
                  className="input"
                  type="date"
                  value={draft.date_range?.to_date ?? ""}
                  disabled={locked}
                  onChange={(e) => setDateRange({ to_date: e.target.value })}
                />
              </label>

              <button className="btn" disabled={locked} onClick={clearDateRange}>
                Effacer
              </button>
            </div>

            <div className="small" style={{ marginTop: 10, ...wrapAny }}>
              {filteredShares.length} lien(s) retenu(s) sur {draft.shares.length}. {filteredSharesWithKnownDateCount} lien(s)
              filtrable(s) avec date connue.
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 12, minWidth: 0 }}>
              <div style={{ minWidth: 0 }}>
                <div className="h2">Participants</div>
                <div className="small">
                  Tous les participants des conversations apparaissent ici. Tu peux les renommer, les regrouper,
                  les défusionner et les activer ou désactiver directement.
                </div>
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
                Regrouper des participants
              </button>
            </div>

            <div className="list">
              {senders.length === 0 ? (
                <div className="small">Aucun participant.</div>
              ) : (
                senders.map((s) => {
                  const isEditing = editingKey === s.sender_key;
                  const isDisabled = !s.active;
                  return (
                    <div
                      className="item"
                      key={s.sender_key}
                      style={{
                        ...itemNoOverflow,
                        opacity: isDisabled ? 0.55 : 1,
                        borderColor: isDisabled ? "rgba(255,255,255,0.12)" : undefined,
                        cursor: locked || isEditing ? "default" : "pointer",
                        background: isDisabled ? "rgba(255,255,255,0.03)" : undefined,
                      }}
                      onClick={locked || isEditing ? undefined : () => handleSenderRowClick(s.sender_key, s.active)}
                    >
                      <div style={{ flex: "1 1 420px", minWidth: 0 }}>
                        {isEditing ? (
                          <div style={{ ...rowNoOverflow, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                            <input
                              className="input"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename();
                                if (e.key === "Escape") cancelRename();
                              }}
                              autoFocus
                              style={{ flex: "1 1 240px", minWidth: 160, maxWidth: "100%" }}
                            />
                            <button className="btn" onClick={commitRename} disabled={locked}>
                              OK
                            </button>
                            <button className="btn" onClick={cancelRename}>
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <div className="row" style={{ gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                            <div
                              className="mono"
                              style={{ cursor: locked ? "default" : "text", ...ellipsis1 }}
                              title={s.name}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!locked) startRename(s.sender_key, s.name);
                              }}
                            >
                              {s.name}
                            </div>
                            <button
                              className="btn"
                              style={{ padding: "4px 8px" }}
                              title="Renommer"
                              disabled={locked}
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(s.sender_key, s.name);
                              }}
                            >
                              <EditIcon />
                            </button>
                            {isDisabled ? <span className="badge warn">Désactivé</span> : <span className="badge ok">Activé</span>}
                          </div>
                        )}

                        {s.merged_children.length ? (
                          <div className="small" style={{ marginTop: 6, opacity: 0.9, ...wrapAny }}>
                            Fusionnés ici :{" "}
                            <span style={wrapAny}>
                              {s.merged_children.map((c) => (
                                <span key={c} style={{ marginRight: 10, display: "inline-block" }}>
                                  <span className="mono" style={wrapAny}>
                                    {c}
                                  </span>{" "}
                                  <button
                                    className="btn"
                                    style={{ padding: "2px 8px" }}
                                    disabled={locked}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      doUnmerge(c);
                                    }}
                                    title="Défusionner ce participant"
                                  >
                                    défusionner
                                  </button>
                                </span>
                              ))}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      <div style={actionsNoOverflow} onClick={(e) => e.stopPropagation()}>
                        <label className="row" style={{ gap: 6, flex: "0 0 auto", cursor: locked ? "default" : "pointer" }}>
                          <input
                            type="checkbox"
                            checked={s.active}
                            disabled={locked}
                            onChange={(e) => toggleActive(s.sender_key, e.target.checked)}
                          />
                          <span className="small">{s.active ? "Activé" : "Disabled"}</span>
                        </label>
                        <span className={s.reels_count > 0 ? "badge ok" : "badge bad"}>{s.reels_count} liens</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div style={{ width: 360, position: "sticky", top: 12, alignSelf: "flex-start", minWidth: 0, flex: "0 1 360px" }}>
          <div className="cardLight" style={{ marginTop: 12 }}>
            <div className="h2">Métriques</div>
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
                    <th style={{ padding: "6px 4px" }}>Métrique</th>
                    <th style={{ padding: "6px 4px" }}>Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "6px 4px" }}>Fichiers</td>
                    <td className="mono" style={{ padding: "6px 4px" }}>{model.stats.files_count}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 4px" }}>Liens importés</td>
                    <td className="mono" style={{ padding: "6px 4px" }}>{draft.shares.length}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 4px" }}>Liens retenus</td>
                    <td className="mono" style={{ padding: "6px 4px" }}>{filteredShares.length}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 4px" }}>Liens uniques retenus</td>
                    <td className="mono" style={{ padding: "6px 4px" }}>{model.stats.urls_unique}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 4px" }}>Liens uniques actifs</td>
                    <td className="mono" style={{ padding: "6px 4px" }}>{activeOnlyItems.length}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 4px" }}>Partagés par plusieurs participants actifs</td>
                    <td className="mono" style={{ padding: "6px 4px" }}>{activeOnlyUrlsMultiSender}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 4px" }}>Participants</td>
                    <td className="mono" style={{ padding: "6px 4px" }}>{model.stats.senders_total}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 4px" }}>Participants actifs</td>
                    <td className="mono" style={{ padding: "6px 4px" }}>{model.stats.senders_active}</td>
                  </tr>

                  <tr>
                    <td colSpan={2} style={{ padding: "8px 0" }}>
                      <div style={{ height: 1, background: "rgba(255,255,255,0.15)" }} />
                    </td>
                  </tr>

                  {!gen ? (
                    <tr>
                      <td colSpan={2} className="small" style={{ padding: "6px 4px" }}>
                        Importe des données pour générer les rounds.
                      </td>
                    </tr>
                  ) : (
                    <>
                      <tr>
                        <td style={{ padding: "6px 4px" }}>Rounds générés</td>
                        <td className="mono" style={{ padding: "6px 4px" }}>{gen.metrics.rounds_generated}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "6px 4px" }}>Liens jouables</td>
                        <td className="mono" style={{ padding: "6px 4px" }}>{gen.metrics.items_total}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: "6px 4px" }}>Liens multi / mono</td>
                        <td className="mono" style={{ padding: "6px 4px" }}>{gen.metrics.items_multi} / {gen.metrics.items_mono}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="h2">Réglages des rounds</div>

              <label style={{ display: "block", marginTop: 12 }}>
                <div className="small" style={{ marginBottom: 6 }}>Seed</div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    value={draft.seed}
                    disabled={locked}
                    onChange={(e) => setSeed(e.target.value)}
                    style={{ flex: "1 1 180px" }}
                  />
                  <button className="btn" disabled={locked} onClick={regenSeed}>
                    Aléatoire
                  </button>
                </div>
              </label>

              <div className="row" style={{ marginTop: 12, gap: 10, flexWrap: "wrap" }}>
                <button className="btn" disabled={!gen || gen.rounds.length === 0} onClick={() => setPreviewOpen(true)}>
                  Prévisualiser les rounds
                </button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="h2">Ouvrir ma partie</div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className={`${importReportTop.length > 0 ? "btn btnPrimary" : "btn"}`}
                  disabled={busy || locked || !gen || gen.metrics.rounds_max <= 0}
                  onClick={connectPlayers}
                  style={{ maxWidth: "100%" }}
                >
                  {busy ? "Envoi…" : "Commencer !"}
                </button>
              </div>

              {!gen || gen.metrics.rounds_max <= 0 ? (
                <div className="small" style={{ marginTop: 8, ...wrapAny }}>
                  Requis : au moins 2 participants actifs avec des liens exploitables.
                </div>
              ) : (
                <div className="small" style={{ marginTop: 8, ...wrapAny }}>
                  {gen.metrics.rounds_generated} round(s) prêt(s) avec {gen.metrics.items_total} lien(s) jouable(s).
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={mergeModalOpen}
        title="Regrouper des participants"
        onClose={() => setMergeModalOpen(false)}
        footer={
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div className="small">
              {mergeReady ? `Fusionner ${nameForKey(aKey)} dans ${nameForKey(bKey)} ?` : "Sélectionne exactement 2 participants."}
            </div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => setMergeModalOpen(false)}>
                Annuler
              </button>
              <button
                className="btn btnPrimary"
                disabled={!mergeReady || locked}
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
        <div className="list">
          {mergeChoices.map((s) => {
            const checked = mergeSelected.includes(s.sender_key);
            return (
              <div className="item" key={s.sender_key} style={{ opacity: s.active ? 1 : 0.55 }}>
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
                <div style={{ flex: "1 1 420px", minWidth: 0 }}>
                  <div className="mono" style={ellipsis1} title={s.name}>{s.name}</div>
                  {s.merged_children.length ? (
                    <div className="small" style={{ marginTop: 6, opacity: 0.9, ...wrapAny }}>
                      Fusionnés : <span className="mono">{s.merged_children.join(", ")}</span>
                    </div>
                  ) : null}
                </div>
                <span className={s.active ? "badge ok" : "badge warn"}>{s.active ? "Activé" : "Disabled"}</span>
                <span className="badge ok">{s.reels_count} liens</span>
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal open={previewOpen} title="Prévisualisation des rounds" onClose={() => setPreviewOpen(false)}>
        {!gen || gen.rounds.length === 0 ? (
          <div className="small">Aucun round généré.</div>
        ) : (
          <>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn" onClick={() => setPreviewN((n) => Math.max(1, n - 1))} disabled={previewN <= 1}>
                ←
              </button>
              <div className="small">
                Round {previewN} / {gen.rounds.length}
              </div>
              <button
                className="btn"
                onClick={() => setPreviewN((n) => Math.min(gen.rounds.length, n + 1))}
                disabled={previewN >= gen.rounds.length}
              >
                →
              </button>
            </div>

            <div className="list" style={{ marginTop: 12 }}>
              {previewRound?.items.map((item, idx) => (
                <div className="item" key={item.item_id} style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="small">Item {idx + 1}</div>
                    <div className="mono" style={wrapAny}>{item.reel.url}</div>
                    <div className="small" style={{ marginTop: 6 }}>
                      Vrais participants : {item.true_sender_ids.map((id) => senderNameById[id] ?? id).join(", ")}
                    </div>
                  </div>
                  <span className="badge ok">k={item.k}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>

      <Modal open={rejModalOpen} title={`Rejets — ${rejModalFile || ""}`} onClose={() => setRejModalOpen(false)}>
        {rejModalFile ? (
          (() => {
            const rej = allRejectedForFile(rejModalFile);
            const fileShares = draft.shares.filter((s) => s.file_name === rejModalFile).slice(0, 20);
            if (rej.length === 0 && fileShares.length === 0) return <div className="small">Aucun rejet.</div>;

            return (
              <>
                <div className="small">Les liens Instagram non pris en charge apparaissent ici. Les posts Instagram ne sont plus rejetés.</div>
                {rej.length > 0 ? (
                  <div className="card" style={{ marginTop: 6 }}>
                    <div className="mono" style={{ marginTop: 10, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      {rej.join("\n")}
                    </div>
                  </div>
                ) : null}

                {fileShares.length > 0 ? (
                  <div className="card" style={{ marginTop: 12 }}>
                    <div className="small">Exemples de liens retenus dans ce fichier</div>
                    <div className="list" style={{ marginTop: 10 }}>
                      {fileShares.map((s, idx) => (
                        <div className="item" key={`${s.url}-${idx}`} style={{ alignItems: "flex-start" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="mono" style={wrapAny}>{s.url}</div>
                            <div className="small" style={{ marginTop: 4 }}>
                              {s.sender_name} — {formatTimestampMs(s.timestamp_ms)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()
        ) : (
          <div className="small">—</div>
        )}
      </Modal>
    </div>
  );
}
