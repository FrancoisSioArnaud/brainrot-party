// frontend/src/pages/master/Setup.tsx
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
  type SenderRow,
} from "../../lib/draftModel";
import { generateRoundsB } from "../../lib/roundGen";

export default function MasterSetup() {
  const nav = useNavigate();
  const session = useMemo(() => loadMasterSession(), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [draft, setDraft] = useState<DraftV1 | null>(() => {
    if (!session) return null;
    const d = loadDraft(session.room_code);
    if (d) return d;
    return {
      v: 1,
      room_code: session.room_code,
      shares: [],
      merge_map: {},
      active_map: {},
      seed: undefined,
      updated_at: Date.now(),
    };
  });

  const model = useMemo(() => (draft ? buildModel(draft) : null), [draft]);

  const [mergeSel, setMergeSel] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const onPickFiles = useCallback(() => fileRef.current?.click(), []);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!session) return;
      if (!files || files.length === 0) return;

      setErr("");
      setBusy(true);
      try {
        const arr = Array.from(files);
        const res = await importInstagramJsonFiles(arr);

        const next: DraftV1 = {
          v: 1,
          room_code: session.room_code,
          shares: [...(draft?.shares ?? []), ...res.shares],
          merge_map: { ...(draft?.merge_map ?? {}) },
          active_map: { ...(draft?.active_map ?? {}) },
          seed: draft?.seed,
          updated_at: Date.now(),
        };

        saveDraft(next);
        setDraft(next);

        if (res.rejected.length > 0) {
          setErr(
            `Import partiel: ${res.rejected.length} rejetés (ex: ${res.rejected[0].reason} / ${res.rejected[0].sample})`
          );
        }
      } catch (e: unknown) {
        setErr(String((e as any)?.message ?? "Import failed"));
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [draft, session]
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

  const persistDraft = useCallback(
    (next: DraftV1) => {
      saveDraft(next);
      setDraft(next);
    },
    []
  );

  const toggleActive = useCallback(
    (sender_key: string, active: boolean) => {
      if (!draft) return;
      persistDraft(toggleSenderActive(draft, sender_key, active));
    },
    [draft, persistDraft]
  );

  const doMerge = useCallback(
    (into_key: string, from_key: string) => {
      if (!draft) return;
      persistDraft(applyMerge(draft, from_key, into_key));
      setMergeSel([]);
    },
    [draft, persistDraft]
  );

  const doUnmerge = useCallback(
    (from_key: string) => {
      if (!draft) return;
      persistDraft(removeMerge(draft, from_key));
      setMergeSel([]);
    },
    [draft, persistDraft]
  );

  const onResetDraft = useCallback(() => {
    if (!session) return;
    clearDraft(session.room_code);
    setDraft({
      v: 1,
      room_code: session.room_code,
      shares: [],
      merge_map: {},
      active_map: {},
      seed: undefined,
      updated_at: Date.now(),
    });
    setMergeSel([]);
    setErr("");
  }, [session]);

  const connectPlayers = useCallback(async () => {
    if (!session || !draft || !model) {
      setErr("Pas de session master / draft.");
      return;
    }

    setErr("");
    setBusy(true);
    try {
      const gen = generateRoundsB({
        room_code: session.room_code,
        seed: draft.seed,
        items: model.items,
        senders: model.senders,
      });

      await uploadRoomSetup(session.room_code, session.master_key, {
        protocol_version: PROTOCOL_VERSION,
        seed: draft.seed,
        senders: gen.senders_payload,
        rounds: gen.rounds,
        round_order: gen.round_order,
      });

      nav("/master/lobby");
    } catch (e: any) {
      const msg = String(e?.message ?? "upload failed");

      if (msg.startsWith("room_expired") || msg.startsWith("room_not_found")) {
        clearMasterSession();
        nav("/?err=room_expired", { replace: true });
        return;
      }

      // Draft corrupted / invalid => stay on setup
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }, [draft, model, nav, session]);

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

  const senders = model?.senders ?? [];
  const stats = model?.stats ?? null;

  const genPreview =
    draft && model
      ? generateRoundsB({
          room_code: session.room_code,
          seed: draft.seed,
          items: model.items,
          senders: model.senders,
        })
      : null;

  function mergeUi(s: SenderRow) {
    const checked = mergeSel.includes(s.sender_key);
    return (
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            const on = e.target.checked;
            setMergeSel((prev) => {
              const next = on
                ? [...prev, s.sender_key]
                : prev.filter((x) => x !== s.sender_key);
              return next.slice(0, 2);
            });
          }}
        />
        <span className="small">merge</span>
      </label>
    );
  }

  const mergeReady = mergeSel.length === 2;

  return (
    <div className="card">
      <div className="h1">Master Setup</div>

      <div className="small">
        Room code: <span className="mono">{session.room_code}</span>
      </div>

      {err ? (
        <div
          className="card"
          style={{ marginTop: 12, borderColor: "rgba(255,80,80,0.5)" }}
        >
          {err}
        </div>
      ) : null}

      {/* Import */}
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
            Filtre: uniquement liens{" "}
            <span className="mono">instagram.com/reel/...</span>
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
            {busy ? "Import..." : "Ajouter des fichiers"}
          </button>
          <button className="btn" disabled={busy} onClick={onResetDraft}>
            Reset draft
          </button>
        </div>

        {stats ? (
          <div className="small" style={{ marginTop: 10 }}>
            Shares: <span className="mono">{stats.shares_total}</span> — URLs
            uniques: <span className="mono">{stats.urls_unique}</span> — Senders:{" "}
            <span className="mono">{stats.senders_total}</span> (actifs:{" "}
            <span className="mono">{stats.senders_active}</span>) — Multi-sender
            items: <span className="mono">{stats.multi_sender_items}</span>
          </div>
        ) : null}
      </div>

      {/* Senders */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">2) Senders</div>
        <div className="small">
          Auto-merge strict + merge manuel (2 cases), toggle active.
        </div>

        {senders.length === 0 ? (
          <div className="small" style={{ marginTop: 10 }}>
            Aucun sender (importe au moins un JSON).
          </div>
        ) : (
          <div className="list" style={{ marginTop: 10 }}>
            {senders.map((s) => (
              <div className="item" key={s.sender_key}>
                <div style={{ minWidth: 220 }}>
                  <div className="mono">{s.name}</div>
                  <div className="small mono">key: {s.sender_key}</div>
                  {s.merged_children.length ? (
                    <div className="small">
                      merged: {s.merged_children.slice(0, 3).join(", ")}
                      {s.merged_children.length > 3 ? "…" : ""}
                    </div>
                  ) : null}
                </div>

                <div className="row" style={{ gap: 12 }}>
                  <span className="badge ok">reels: {s.reels_count}</span>
                  <label className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) =>
                        toggleActive(s.sender_key, e.target.checked)
                      }
                    />
                    <span className="small">active</span>
                  </label>

                  {mergeUi(s)}
                </div>
              </div>
            ))}
          </div>
        )}

        {mergeReady ? (
          <div className="card" style={{ marginTop: 10 }}>
            <div className="small">
              Merge sélection: <span className="mono">{mergeSel[0]}</span> +{" "}
              <span className="mono">{mergeSel[1]}</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn"
                disabled={busy}
                onClick={() => doMerge(mergeSel[0], mergeSel[1])}
              >
                Merge {mergeSel[1]} → {mergeSel[0]}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => doMerge(mergeSel[1], mergeSel[0])}
              >
                Merge {mergeSel[0]} → {mergeSel[1]}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  doUnmerge(mergeSel[0]);
                  doUnmerge(mergeSel[1]);
                }}
              >
                Unmerge
              </button>
            </div>
          </div>
        ) : (
          <div className="small" style={{ marginTop: 10 }}>
            (Tip) Coche 2 senders pour proposer un merge.
          </div>
        )}
      </div>

      {/* Rounds */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">3) Génération des rounds (Option B)</div>
        {!genPreview ? (
          <div className="small" style={{ marginTop: 10 }}>
            Importe des données pour générer.
          </div>
        ) : (
          <>
            <div className="small" style={{ marginTop: 10 }}>
              Active senders:{" "}
              <span className="mono">{genPreview.metrics.active_senders}</span>{" "}
              — Rounds max:{" "}
              <span className="mono">{genPreview.metrics.rounds_max}</span> —
              Rounds complete:{" "}
              <span className="mono">{genPreview.metrics.rounds_complete}</span>{" "}
              — Items total:{" "}
              <span className="mono">{genPreview.metrics.items_total}</span>
            </div>

            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setPreviewOpen((v) => !v)}>
                {previewOpen ? "Masquer preview" : "Preview 1er round"}
              </button>
            </div>

            {previewOpen && genPreview.rounds[0] ? (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="small">
                  Round:{" "}
                  <span className="mono">{genPreview.rounds[0].round_id}</span>{" "}
                  — items:{" "}
                  <span className="mono">
                    {genPreview.rounds[0].items.length}
                  </span>
                </div>
                <div className="list" style={{ marginTop: 8 }}>
                  {genPreview.rounds[0].items.slice(0, 8).map((it) => (
                    <div className="item" key={it.item_id}>
                      <div style={{ minWidth: 240 }}>
                        <div className="small mono">{it.item_id}</div>
                        <div className="small mono">
                          k={it.true_sender_ids.length}
                        </div>
                        <div className="small" style={{ wordBreak: "break-all" }}>
                          {it.reel.url}
                        </div>
                      </div>
                      <div className="small mono">
                        true: {it.true_sender_ids.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Connect players */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="h2">4) Connecter les joueurs</div>
        <div className="small">
          Envoie le setup final au backend (source of truth) puis ouvre le Lobby.
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            disabled={
              busy || !genPreview || (genPreview?.metrics.rounds_max ?? 0) === 0
            }
            onClick={connectPlayers}
          >
            {busy ? "Envoi..." : "Connecter les joueurs"}
          </button>
        </div>
        {!genPreview || (genPreview?.metrics.rounds_max ?? 0) === 0 ? (
          <div className="small" style={{ marginTop: 8 }}>
            Requis: au moins 2 senders actifs avec des reels (sinon rounds_max=0).
          </div>
        ) : null}
      </div>
    </div>
  );
}
