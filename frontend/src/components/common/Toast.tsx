import React, { useEffect, useState } from "react";
import styles from "./Toast.module.css";

type ToastItem = { id: string; message: string };

let listeners: Array<(items: ToastItem[]) => void> = [];
let items: ToastItem[] = [];

export function toast(message: string) {
  const id = String(Date.now()) + Math.random().toString(16).slice(2);
  items = [...items, { id, message }];
  listeners.forEach((l) => l(items));
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    listeners.forEach((l) => l(items));
  }, 3000);
}

export default function ToastHost() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    const fn = (x: ToastItem[]) => setList(x);
    listeners.push(fn);
    fn(items);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  }, []);

  if (list.length === 0) return null;
  return (
    <div className={styles.host}>
      {list.map((t) => (
        <div key={t.id} className={styles.toast}>{t.message}</div>
      ))}
    </div>
  );
}
