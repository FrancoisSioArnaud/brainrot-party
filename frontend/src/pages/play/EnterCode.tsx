import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import styles from "./EnterCode.module.css";
import { popOneShotError } from "../../utils/playSession";

function normalizeCode(input: string) {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
}

export default function PlayEnterCode() {
  const nav = useNavigate();
  const [sp] = useSearchParams();

  const prefill = useMemo(() => normalizeCode(sp.get("code") || ""), [sp]);
  const [code, setCode] = useState(prefill);

  const oneShotError = useMemo(() => popOneShotError(), []);
  const [localErr] = useState(oneShotError || "");

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Rejoindre</h1>

      {localErr ? (
        <div style={{ marginBottom: 10, padding: 12, borderRadius: 14, border: "1px solid var(--border)" }}>
          {localErr}
        </div>
      ) : null}

      <input
        className={styles.input}
        value={code}
        onChange={(e) => setCode(normalizeCode(e.target.value))}
        placeholder="AB12CD"
        maxLength={6}
      />

      <button
        className={styles.primary}
        disabled={code.length !== 6}
        onClick={() => {
          const c = normalizeCode(code);
          if (c.length !== 6) return;
          localStorage.setItem("brp_join_code", c);
          nav("/play/choose", { replace: true });
        }}
      >
        Rejoindre
      </button>
    </div>
  );
}
