import React, { useRef } from "react";
import { useDraftStore } from "../../../store/draftStore";
import FilesTable from "./FilesTable";

export default function ImportSection() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const importFiles = useDraftStore(s => s.importFiles);
  const parsingBusy = useDraftStore(s => s.parsing_busy);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Import</h2>
      <p style={{ color: "var(--muted)", fontWeight: 700, marginTop: 6 }}>
        Ajoute tes exports Instagram (messages.json).
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          multiple
          style={{ display: "none" }}
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) await importFiles(files);
            e.currentTarget.value = "";
          }}
          disabled={parsingBusy}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <FilesTable />
      </div>
    </div>
  );
}
