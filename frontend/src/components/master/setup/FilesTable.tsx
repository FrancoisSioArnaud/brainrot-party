import React, { useMemo } from "react";
import { useDraftStore } from "../../../store/draftStore";

function buildRejectedCsv(files: Array<{ name: string; rejected_urls: string[] }>) {
  // Format spec:
  // ### message1.json
  // url1
  // url2
  //
  // ### message2.json
  // url3
  const parts: string[] = [];
  for (const f of files) {
    const urls = (f.rejected_urls || []).filter(Boolean);
    if (urls.length === 0) continue;
    parts.push(`### ${f.name}`);
    parts.push(...urls);
    parts.push(""); // blank line between files
  }
  return parts.join("\n");
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function FilesTable() {
  const files = useDraftStore(s => s.files);
  const removeFile = useDraftStore(s => s.removeFile);
  const parsingBusy = useDraftStore(s => s.parsing_busy);

  const totalRejected = useMemo(() => {
    return files.reduce((sum, f) => sum + ((f.rejected_urls || []).length || 0), 0);
  }, [files]);

  if (files.length === 0) {
    return <div style={{ color: "var(--muted)", fontWeight: 700 }}>Aucun fichier importé.</div>;
  }

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Fichier</th>
            <th align="right">Messages</th>
            <th align="right">Participants</th>
            <th align="right">Erreurs</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "8px 0", fontWeight: 900 }}>{f.name}</td>
              <td align="right">{f.messages_found}</td>
              <td align="right">{f.participants_found}</td>
              <td
                align="right"
                style={{ color: f.errors_count ? "var(--warn)" : "var(--muted)", fontWeight: 900 }}
              >
                {f.errors_count}
              </td>
              <td align="right">
                <button
                  style={{
                    padding: "6px 10px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text)"
                  }}
                  onClick={async () => {
                    await removeFile(f.id);
                  }}
                  disabled={parsingBusy}
                >
                  Retirer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalRejected > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text)",
              fontWeight: 900
            }}
            disabled={parsingBusy}
            onClick={() => {
              const csv = buildRejectedCsv(files);
              downloadTextFile("brainrot-rejected-urls.csv", csv);
            }}
          >
            Exporter URLs rejetées (CSV)
          </button>
        </div>
      )}
    </div>
  );
}
