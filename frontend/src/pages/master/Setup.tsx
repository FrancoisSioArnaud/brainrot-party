import React, { useCallback, useMemo, useState } from "react";
import styles from "./Setup.module.css";

type ImportItem = {
  id: string;
  filename: string;
  raw: any;
};

function generateId() {
  return crypto.randomUUID();
}

export default function Setup() {
  const [imports, setImports] = useState<ImportItem[]>([]);

  const handleFileImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const newItems: ImportItem[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await file.text();

        try {
          const json = JSON.parse(text);

          newItems.push({
            id: generateId(),
            filename: file.name,
            raw: json,
          });
        } catch (err) {
          console.error("Invalid JSON:", file.name);
        }
      }

      setImports((prev) => [...prev, ...newItems]);
      e.target.value = "";
    },
    []
  );

  // ✅ FIX : supprime uniquement l'import ciblé
  const handleDeleteImport = useCallback((id: string) => {
    setImports((prev) => prev.filter((imp) => imp.id !== id));
  }, []);

  const totalImports = useMemo(() => imports.length, [imports]);

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Setup</h1>

      <div className={styles.importSection}>
        <div className={styles.importHeader}>
          <h2>Imports Instagram JSON</h2>

          <label className={styles.importButton}>
            Importer un fichier
            <input
              type="file"
              accept="application/json"
              multiple
              hidden
              onChange={handleFileImport}
            />
          </label>
        </div>

        <div className={styles.importList}>
          {imports.length === 0 && (
            <div className={styles.empty}>Aucun import pour le moment</div>
          )}

          {imports.map((imp) => (
            <div key={imp.id} className={styles.importItem}>
              <div className={styles.importInfo}>
                <span className={styles.filename}>{imp.filename}</span>
              </div>

              <button
                className={styles.deleteButton}
                onClick={() => handleDeleteImport(imp.id)}
              >
                Supprimer
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.metrics}>
        <p>Total imports : {totalImports}</p>
      </div>
    </div>
  );
}
