import React from "react";
import { useDraftStore } from "../../../store/draftStore";

export default function FilesTable() {
  const files = useDraftStore(s => s.files);
  const removeFile = useDraftStore(s => s.removeFile);

  if (files.length === 0) {
    return <div style={{ color: "var(--muted)", fontWeight: 700 }}>Aucun fichier importé.</div>;
  }

  return (
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
            <td align="right" style={{ color: f.errors_count ? "var(--warn)" : "var(--muted)", fontWeight: 900 }}>
              {f.errors_count}
            </td>
            <td align="right">
              <button
                style={{ padding: "6px 10px", borderRadius: 12, border: "1px solid var(--border)", background: "transparent", color: "var(--text)" }}
                onClick={() => removeFile(f.id)}
              >
                Retirer
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
