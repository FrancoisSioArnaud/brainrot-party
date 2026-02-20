import React, { useRef, useState } from "react";
import { useDraftStore } from "../../../store/draftStore";
import FilesTable from "./FilesTable";

export default function ImportSection() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const importFiles = useDraftStore(s => s.importFiles);
  const parsingBusy = useDraftStore(s => s.parsing_busy);

  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return;
    // Optionnel: filtrer JSON uniquement
    const jsonFiles = files.filter(f => {
      const name = (f.name || "").toLowerCase();
      return name.endsWith(".json") || f.type === "application/json";
    });
    await importFiles(jsonFiles.length ? jsonFiles : files);
  };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Import</h2>
      <p style={{ color: "var(--muted)", fontWeight: 700, marginTop: 6 }}>
        Importe 1+ exports Instagram (JSON). Extraction: <code>messages[].share.link</code>
      </p>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (parsingBusy) return;
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (parsingBusy) return;
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          if (parsingBusy) return;
          const dt = e.dataTransfer;
          if (!dt?.files || dt.files.length === 0) return;
          await handleFiles(dt.files);
        }}
        style={{
          marginTop: 10,
          borderRadius: 18,
          border: `2px dashed ${dragOver ? "var(--text)" : "var(--border)"}`,
          background: dragOver ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
          padding: 16,
          transition: "background 120ms ease, border-color 120ms ease",
          opacity: parsingBusy ? 0.6 : 1,
          pointerEvents: parsingBusy ? "none" : "auto"
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text)",
              fontWeight: 900
            }}
            onClick={() => inputRef.current?.click()}
            disabled={parsingBusy}
          >
            Ajouter des fichiers
          </button>

          <div style={{ color: "var(--muted)", fontWeight: 800 }}>
            ou glisse-dépose tes fichiers JSON ici
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            multiple
            style={{ display: "none" }}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              await handleFiles(files);
              e.currentTarget.value = "";
            }}
            disabled={parsingBusy}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <FilesTable />
        </div>
      </div>
    </div>
  );
}
