import React, { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PROTOCOL_VERSION } from "@brp/contracts";
import { uploadRoomSetup, isBrpApiError } from "../../lib/api";
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

function formatSetupPostError(err: unknown): string {
  const fallback = String((err as any)?.message ?? err ?? "Erreur inconnue");

  const msgFromCode = (code: string, message?: string) => {
    if (code === "room_expired") return "Room expirée. Recrée une partie.";
    if (code === "room_not_found") return "Room introuvable. Recrée une partie.";
    if (code === "invalid_master_key") return "Clé master invalide. Recrée une partie.";
    if (code.startsWith("validation_error:")) {
      const field = code.slice("validation_error:".length) || "payload";
      const fieldLabel: Record<string, string> = {
        protocol_version: "Version de protocole",
        master_key: "Clé master",
        room_code: "Code room",
        payload: "Payload",
        seed: "Seed",
        k_max: "k_max",
        senders: "Senders",
        rounds: "Rounds",
        round_order: "Ordre des rounds",
        setup_locked: "Setup verrouillé",
      };
      const nice = fieldLabel[field] ?? field;
      return `Validation (${nice}) : ${message || "Payload invalide"}`;
    }
    return message ? `${code}: ${message}` : code;
  };

  if (isBrpApiError(err)) {
    return msgFromCode(err.code, err.message);
  }

  const s = fallback;
  const i = s.indexOf(":");
  if (i > 0) {
    const code = s.slice(0, i).trim();
    const message = s.slice(i + 1).trim();
    if (code) return msgFromCode(code, message);
  }

  return s;
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
      if (locked) return;
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
    [draft, locked, persist, session]
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
    if (locked) return;
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
  }, [locked, persist, session]);

  const deleteImportFile = useCallback(
    (fileName: string) => {
      if (!draft) return;
      if (locked) return;

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
    [draft, locked, persist, rejModalFile, rejModalOpen]
  );

  const toggleActive = useCallback(
    (sender_key: string, active: boolean) => {
      if (!draft) return;
      if (locked) return;
      persist(toggleSenderActive(draft, sender_key, active));
    },
    [draft, locked, persist]
  );

  const doMerge = useCallback(
    (fromKey: string, intoKey: string) => {
      if (!draft) return;
      if (locked) return;
      const next = applyMerge(draft, fromKey, intoKey);
      persist(next);
      setMergeSelected([]);
      setMergeModalOpen(false);
    },
    [draft, locked, persist]
  );

  const doUnmerge = useCallback(
    (childKey: string) => {
      if (!draft) return;
      if (locked) return;
      persist(removeMerge(draft, childKey));
    },
    [draft, locked, persist]
  );

  const startRename = useCallback(
    (sender_key: string, currentName: string) => {
      if (locked) return;
      setEditingKey(sender_key);
      setEditingValue(currentName);
    },
    [locked]
  );

  const commitRename = useCallback(() => {
    if (!draft || !editingKey) return;
    if (locked) return;
    const val = editingValue.trim();

    const name_overrides = { ...(draft.name_overrides || {}) };
    if (!val) delete name_overrides[editingKey];
    else name_overrides[editingKey] = val;

    persist({ ...draft, name_overrides, updated_at: Date.now() });
    setEditingKey(null);
    setEditingValue("");
  }, [draft, editingKey, editingValue, locked, persist]);

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

  const goLobby = useCallback(() => {
    nav("/master/lobby");
  }, [nav]);

  const connectPlayers = useCallback(async () => {
    if (!session || !draft || !model || !gen) {
      setErr("Pas de session master / draft.");
      return;
    }
    if (locked) {
      nav("/master/lobby");
      return;
    }

    setErr("");
    setBusy(true);
    try {
      if (gen.metrics.rounds_max <= 0) {
        throw new Error("validation_error:rounds: rounds_max=0 (il faut au moins 2 senders actifs avec des reels)");
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

      const lockedDraft: DraftV1 = { ...draft, setup_sent_at: Date.now(), updated_at: Date.now() };
      persist(lockedDraft);

      nav("/master/lobby");
    } catch (e: any) {
      const code = isBrpApiError(e) ? e.code : String(e?.message ?? "");

      if (code.startsWith("room_expired") || code.startsWith("room_not_found")) {
        clearMasterSession();
        if (session) clearDraft(session.room_code);
        nav("/?err=room_expired", { replace: true });
        return;
      }

      setErr(formatSetupPostError(e));
    } finally {
      setBusy(false);
    }
  }, [draft, gen, locked, model, nav, persist, session]);

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

  const addMergeSelection = (key: string) => {
    if (mergeSelected.includes(key)) {
      setMergeSelected(mergeSelected.filter((k) => k !== key));
      return;
    }
    if (mergeSelected.length >= 2) return;
    setMergeSelected([...mergeSelected, key]);
  };

  const canMerge = mergeReady && aKey && bKey && aKey !== bKey;

  const previewTotal = gen?.rounds?.length ?? 0;

  return (
    <div className="card" onDrop={onDrop} onDragOver={onDragOver}>
      <div className="h1">Setup</div>

      <div className="small">
        Room: <span className="mono">{session.room_code}</span>
      </div>

      {locked ? (
        <div className="card" style={{ marginTop: 12, borderColor: "rgba(120,255,120,0.35)" }}>
          <div className="h2">Setup envoyé</div>
          <div className="small" style={{ marginTop: 6 }}>
            Draft verrouillé (read-only) tant que la room est active.
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={goLobby}>
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

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/json"
        style={{ display: "none" }}
        onChange={(e) => onFiles(e.target.files)}
        disabled={locked}
      />

      <div className="card" style={{ marginTop: 12, opacity: locked ? 0.65 : 1 }}>
        <div className="h2">Import</div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={onPickFiles} disabled={busy || locked}>
            Importer exports Instagram (JSON)
          </button>
          <button className="btn" onClick={onResetDraft} disabled={busy || locked}>
            Reset draft
          </button>
          <span className="small">(Tu peux drag&drop des fichiers ici)</span>
        </div>

        <div className="small" style={{ marginTop: 10 }}>
          Fichiers: {model.stats.files_count} · Shares: {model.stats.shares_total} · URLs uniques:{" "}
          {model.stats.urls_unique} · Multi-sender: {model.stats.urls_multi_sender}
        </div>

        {importReportTop.length ? (
          <div className="list" style={{ marginTop: 10 }}>
            {importReportTop.map((r) => (
              <div className="item" key={r.file_name}>
                <div style={{ minWidth: 0 }}>
                  <div className="mono">{r.file_name}</div>
                  <div className="small">
                    Ajoutées: {r.shares_added} · Rejetées: {r.rejected_count} · Participants:{" "}
                    {(r.participants_detected || []).length}
                  </div>
                </div>

                <div className="row" style={{ gap: 10 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      setRejModalOpen(true);
                      setRejModalFile(r.file_name);
                    }}
                    disabled={busy || r.rejected_count <= 0}
                  >
                    Voir rejets
                  </button>

                  <button className="btn" onClick={() => deleteImportFile(r.file_name)} disabled={busy || locked}>
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="small" style={{ marginTop: 10 }}>
            Aucun import pour l’instant.
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12, opacity: locked ? 0.65 : 1 }}>
        <div className="h2">Senders</div>

        <div className="small" style={{ marginTop: 8 }}>
          Total: {model.stats.senders_total} · Actifs: {model.stats.senders_active} · Reels min/median/max:{" "}
          {model.stats.reels_min}/{model.stats.reels_median}/{model.stats.reels_max}
        </div>

        <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setMergeModalOpen(true)} disabled={busy || locked || senders.length < 2}>
            Fusionner 2 senders
          </button>

          <button
            className="btn"
            onClick={() => {
              setPreviewN(1);
              setPreviewOpen(true);
            }}
            disabled={busy || !gen || gen.rounds.length === 0}
          >
            Preview rounds
          </button>

          <button className="btn primary" onClick={connectPlayers} disabled={busy || !gen}>
            {locked ? "Aller au Lobby" : "Connecter les joueurs"}
          </button>
        </div>

        <div className="list" style={{ marginTop: 10 }}>
          {senders.map((s) => {
            const isChild = !!draft.merge_map?.[s.sender_key];

            return (
              <div className="item" key={s.sender_key}>
                <div style={{ minWidth: 0 }}>
                  <div className="mono">{s.name}</div>
                  <div className="small mono">
                    {s.sender_key} · reels: {s.reels_count} · enfants: {s.merged_children.length}
                    {isChild ? " · (child merged)" : ""}
                  </div>
                </div>

                <div className="row" style={{ gap: 10 }}>
                  <label className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) => toggleActive(s.sender_key, e.target.checked)}
                      disabled={busy || locked}
                    />
                    <span className="small">active</span>
                  </label>

                  <button className="btn" onClick={() => startRename(s.sender_key, s.name)} disabled={busy || locked}>
                    Renommer
                  </button>

                  {isChild ? (
                    <button className="btn" onClick={() => doUnmerge(s.sender_key)} disabled={busy || locked}>
                      Dé-fusionner
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        open={mergeModalOpen}
        title="Fusionner 2 senders (A → B)"
        onClose={() => {
          setMergeSelected([]);
          setMergeModalOpen(false);
        }}
        footer={
          <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button
              className="btn"
              onClick={() => {
                setMergeSelected([]);
                setMergeModalOpen(false);
              }}
            >
              Annuler
            </button>
            <button className="btn primary" disabled={busy || locked || !canMerge} onClick={() => doMerge(aKey, bKey)}>
              Fusionner
            </button>
          </div>
        }
      >
        <div className="small">Clique 2 senders. Le premier sélectionné sera fusionné dans le second.</div>
        <div className="list" style={{ marginTop: 10 }}>
          {mergeChoices.map((s) => {
            const selected = mergeSelected.includes(s.sender_key);
            return (
              <div
                key={s.sender_key}
                className="item"
                style={{ cursor: "pointer", borderColor: selected ? "rgba(255,255,255,0.35)" : undefined }}
                onClick={() => addMergeSelection(s.sender_key)}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="mono">{s.name}</div>
                  <div className="small mono">
                    {s.sender_key} · reels: {s.reels_count} · {s.active ? "active" : "inactive"} · enfants:{" "}
                    {s.merged_children.length}
                  </div>
                </div>
                <span className={selected ? "badge ok" : "badge"}>{selected ? "Sélectionné" : "—"}</span>
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={rejModalOpen}
        title={`Rejets — ${rejModalFile}`}
        onClose={() => {
          setRejModalOpen(false);
          setRejModalFile("");
        }}
      >
        <div className="small">Exemples de lignes rejetées (raw).</div>
        <div className="card" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
          {allRejectedForFile(rejModalFile).slice(0, 200).join("\n")}
        </div>
      </Modal>

      <Modal
        open={editingKey !== null}
        title="Renommer sender"
        onClose={cancelRename}
        footer={
          <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
            <button className="btn" onClick={cancelRename}>
              Annuler
            </button>
            <button className="btn primary" onClick={commitRename} disabled={busy || locked}>
              Enregistrer
            </button>
          </div>
        }
      >
        <div className="small mono">{editingKey}</div>
        <input
          className="input"
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          placeholder="Nom"
          style={{ marginTop: 10, width: "100%" }}
          disabled={locked}
        />
        <div className="small" style={{ marginTop: 10 }}>
          Vide = supprimer l’override (retour au nom calculé).
        </div>
      </Modal>

      <Modal
        open={previewOpen}
        title="Preview rounds"
        onClose={() => setPreviewOpen(false)}
        footer={
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn" onClick={() => setPreviewN(Math.max(1, previewN - 1))} disabled={previewN <= 1}>
                ←
              </button>
              <div className="small">
                Round {previewN} / {previewTotal}
              </div>
              <button
                className="btn"
                onClick={() => setPreviewN(Math.min(previewTotal || 1, previewN + 1))}
                disabled={previewN >= (previewTotal || 1)}
              >
                →
              </button>
            </div>

            <button className="btn" onClick={() => setPreviewOpen(false)}>
              Fermer
            </button>
          </div>
        }
      >
        {!gen ? (
          <div className="small">No gen.</div>
        ) : !previewRound ? (
          <div className="small">No round.</div>
        ) : (
          <>
            <div className="small">
              rounds_complete: {gen.metrics.rounds_complete} · urls_unique: {gen.metrics.urls_unique} · multi_sender:{" "}
              {gen.metrics.urls_multi_sender}
            </div>

            <div className="list" style={{ marginTop: 10 }}>
              {previewRound.items.slice(0, 12).map((it) => (
                <div className="item" key={it.item_id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="mono">{it.reel.url}</div>
                    <div className="small mono">
                      k={it.k} · true={it.true_sender_ids.map((id) => senderNameById[id] ?? id).join(", ")}
                    </div>
                  </div>
                  <span className={it.true_sender_ids.length >= 2 ? "badge warn" : "badge ok"}>
                    {it.true_sender_ids.length >= 2 ? "multi" : "mono"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
