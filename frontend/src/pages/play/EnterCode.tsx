import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import styles from "./EnterCode.module.css";

export default function PlayEnterCode() {
  const nav = useNavigate();
  const [sp] = useSearchParams();

  const prefill = useMemo(() => {
    const c = (sp.get("code") || "").trim().toUpperCase();
    return c.slice(0, 6);
  }, [sp]);

  const [code, setCode] = useState(prefill);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Rejoindre</h1>
      <input
        className={styles.input}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="AB12CD"
        maxLength={6}
      />
      <button className={styles.primary} onClick={() => nav(`/play/choose/${encodeURIComponent(code.trim())}`)}>
        Rejoindre
      </button>
    </div>
  );
}
