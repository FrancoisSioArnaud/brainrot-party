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
  normalizeSenderNameStrict,
} from "../../lib/draftModel";
import { generateRoundsB } from "../../lib/roundGen";

type SortMode = "active_reels" | "reels" | "alpha";

function newDraft(room_code: string): DraftV1 {
  return {
    v: 1,
    room_code,
    shares: [],
    import_reports: [],
    merge_map: {},
    active_map: {},
    seed: "",
    k_max: 4,
    updated_at: Date.now(),
  };
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

  // sender UI
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("active_reels");

  // merge UI
  const [mergeChild, setMergeChild] = useState<string>("");
  const [mergeTarget, setMergeTarget] = useState<string>("");

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
            ...res.shares.map((s) => ({ url: s.url, sender_name: s.sender_name, file_name: s.file_name })),
          ],
          import_reports: [
            ...draft.import_reports,
            ...res.by_file.map((r) => ({
              file_name: r.file_name,
              shares_added: r.shares_added,
              rejected_count: r.rejected_count,
              rejected_samples: r.rejected_samples,
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
    setSearch("");
    setSortMode("active_reels");
    setMergeChild("");
    setMergeTarget("");
    setPreviewN(1);
    setPreviewOpen(false);
  }, [persist, session]);

  const toggleActive = useCallback(
    (sender_key: string, active: boolean) => {
      if (!draft) return;
      persist(toggleSenderActive(draft, sender_key, active));
    },
    [draft, persist]
  );

  const doMerge = useCallback(() => {
    if (!draft) return;
    const child = normalizeSenderNameStrict(mergeChild);
    const target = normalizeSenderNameStrict(mergeTarget);
    if (!child || !target || child === target) return;

    const next = applyMerge(draft, child, target);
    if (next === draft) {
      setErr("Merge invalide (boucle ou keys invalides).");
      return;
    }
    persist(next);
    setMergeChild("");
    setMergeTarget("");
    setErr("");
  }, [draft, mergeChild, mergeTarget, persist]);

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
          shares_total: model.stats.shares_total,
          urls_unique: model.stats.urls_unique,
          urls_multi_sender: model.stats.urls_multi_sender,
          senders_total: model.stats.senders_total,
          senders_active: model.stats.senders_active,
          reels_min: model.stats.reels_min,
          reels_median: model.stats.reels_median,
          reels_max: model.stats.reels_max,
          files_count: model.stats.files_count,
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

  // sender filtering/sorting
  let senders = model.senders.slice();
  const q = search.trim().toLowerCase();
  if (q) senders = senders.filter((s) => s.name.toLowerCase().includes(q) || s.sender_key.includes(q));

  if (sortMode === "reels") {
    senders.sort((a, b) => (b.reels_count !== a.reels_count ? b.reels_count - a.reels_count : a.name.localeCompare(b.name)));
  } else if (sortMode === "alpha") {
    senders.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // active_reels
    senders.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (b.reels_count !== a.reels_count) return b.reels_count - a.reels_count;
      return a.name.localeCompare(b.name);
    });
  }

  const previewRound = gen?.rounds?.[Math.max(0, Math.min((gen.rounds.length || 1) - 1, previewN - 1))] ?? null;
  const senderNameById = useMemo(() => {
    if (!gen) return {};
    const map: Record<string, string> = {};
    for (const s of gen.senders_payload) map[s.sender_id] = s.name;
    return map;
  }, [gen]);

  const importReportTop = draft.import_reports.slice(-10).reverse();

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
          <div className="small">Drag & drop 1+ exports Instagram (.json) ici, ou clique pour choisir.</div>
          <div className="small" style={{ marginTop: 6 }}>
            Filtre strict: uniquement <span className="mono">instagram.com/reel/…</span> ou <span className="mono">/reels/…</span>
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

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={busy} onClick={onPickFiles}>
            {busy ? "Import…" : "Ajouter des fichiers"}
          </button>
          <button className="btn" disabled={busy} onClick={onResetDraft}>
            Reset draft
          </button>
        </div>

        <div className="small" style={{ marginTop: 10 }}>
          Files: <span className="mono">{model.stats.files_count}</span> — Shares: <span className="mono">{model.stats.shares_total}</span> — URLs uniques:{" "}
          <span className="mono">{model.stats.urls_unique}</span> — Multi-sender URLs: <span className="mono">{model.stats.urls_multi_sender}</span>
        </div>

        {/* Import report */}
        <div className="card" style={{ marginTop: 10 }}>
          <div className="h2">Import report (dernier)</div>
          {importReportTop.length === 0 ? (
            <div className="small">—</div>
          ) : (
            <div className="list" style={{ marginTop: 8 }}>
              {importReportTop.map((r, idx) => (
                <div className="item" key={`${r.file_name}-${idx}`}>
                  <div style={{ minWidth: 260 }}>
                    <div className="mono">{r.file_name}</div>
                    <div className="small">
                      shares_added: <span className="mono">{r.shares_added}</span> — rejected: <span className="mono">{r.rejected_count}</span>
                    </div>
                  </div>
                  <div className="small" style={{ maxWidth: 520 }}>
                    {r.rejected_samples.slice(0, 3).map((x, i) => (
                      <div key={i} className="mono" style={{ opacity: 0.85 }}>
                        {x.reason}: {x.sample}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2) Senders */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">2) Senders</div>

        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sender…" />
          <select className="input" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
            <option value="active_reels">Active first, reels desc</option>
            <option value="reels">Reels desc</option>
            <option value="alpha">Alphabetical</option>
          </select>
        </div>

        <div className="small" style={{ marginTop: 8 }}>
          Senders: <span className="mono">{model.stats.senders_total}</span> (actifs: <span className="mono">{model.stats.senders_active}</span>) — reels min/median/max:{" "}
          <span className="mono">{model.stats.reels_min}</span>/<span className="mono">{model.stats.reels_median}</span>/<span className="mono">{model.stats.reels_max}</span>
        </div>

        {/* Merge panel */}
        <div className="card" style={{ marginTop: 10 }}>
          <div className="h2">Merge manuel</div>
          <div className="small">Choisis un “child” puis un “target”. Unmerge possible dans la liste.</div>
          <div className="row" style={{ marginTop: 10, gap: 10 }}>
            <input className="input" value={mergeChild} onChange={(e) => setMergeChild(e.target.value)} placeholder="child sender key / name" />
            <input className="input" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} placeholder="target sender key / name" />
            <button className="btn" disabled={busy} onClick={doMerge}>
              Merge
            </button>
          </div>
          <div className="small" style={{ marginTop: 8 }}>
            Tip: utilise les keys root (colonne “key”) ; normalisation stricte appliquée (casse/ @ / _-.).
          </div>
        </div>

        {/* Senders table */}
        <div className="list" style={{ marginTop: 10 }}>
          {senders.length === 0 ? (
            <div className="small">Aucun sender.</div>
          ) : (
            senders.map((s) => (
              <div className="item" key={s.sender_key}>
                <div style={{ minWidth: 280 }}>
                  <div className="mono">{s.name}</div>
                  <div className="small mono">key: {s.sender_key}</div>
                  {s.merged_children.length ? (
                    <div className="small">
                      children:{" "}
                      {s.merged_children.map((c) => (
                        <span key={c} style={{ marginRight: 8 }}>
                          <span className="mono">{c}</span>{" "}
                          <button className="btn" style={{ padding: "2px 8px" }} onClick={() => doUnmerge(c)}>
                            unmerge
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="row" style={{ gap: 12 }}>
                  <span className="badge ok">reels: {s.reels_count}</span>
                  <label className="row" style={{ gap: 6 }}>
                    <input type="checkbox" checked={s.active} onChange={(e) => toggleActive(s.sender_key, e.target.checked)} />
                    <span className="small">active</span>
                  </label>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 3) Rounds */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">3) Génération des rounds (Option B)</div>

        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <label className="small">
            seed{" "}
            <input className="input" value={draft.seed} onChange={(e) => setSeed(e.target.value)} placeholder="(optional)" style={{ width: 220 }} />
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
              Active senders: <span className="mono">{gen.metrics.active_senders}</span> — rounds_max (2e sender):{" "}
              <span className="mono">{gen.metrics.rounds_max}</span> — rounds_complete (min):{" "}
              <span className="mono">{gen.metrics.rounds_complete}</span> — items_total:{" "}
              <span className="mono">{gen.metrics.items_total}</span> — unused_urls:{" "}
              <span className="mono">{gen.debug.unused_urls}</span> — fallback_picks:{" "}
              <span className="mono">{gen.debug.fallback_picks}</span>
            </div>

            <div className="row" style={{ marginTop: 10, gap: 10 }}>
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
              <div className="card" style={{ marginTop: 10 }}>
                <div className="small">
                  {previewRound.round_id} — items: <span className="mono">{previewRound.items.length}</span>
                </div>
                <div className="list" style={{ marginTop: 8 }}>
                  {previewRound.items.slice(0, 12).map((it) => (
                    <div className="item" key={it.item_id}>
                      <div style={{ minWidth: 260 }}>
                        <div className="small mono">{it.item_id}</div>
                        <div className="small mono">k={it.k}</div>
                        <div className="small" style={{ wordBreak: "break-all" }}>
                          {it.reel.url}
                        </div>
                      </div>
                      <div className="small">
                        true:{" "}
                        <span className="mono">
                          {it.true_sender_ids
                            .map((id) => senderNameById[id] ?? id)
                            .join(", ")}
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

      {/* 4) Upload */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">4) Connecter les joueurs</div>
        <div className="small">POST /room/:code/setup (backend source of truth) → puis Lobby.</div>

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" disabled={busy || !gen || gen.metrics.rounds_max <= 0} onClick={connectPlayers}>
            {busy ? "Envoi…" : "Connecter les joueurs"}
          </button>
        </div>

        {!gen || gen.metrics.rounds_max <= 0 ? (
          <div className="small" style={{ marginTop: 8 }}>
            Requis: au moins 2 senders actifs avec reels (sinon rounds_max=0).
          </div>
        ) : null}
      </div>
    </div>
  );
}
