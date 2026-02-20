import React from "react";
import styles from "./Avatar.module.css";

export default function Avatar({
  src,
  size = 40,
  label
}: {
  src?: string | null;
  size?: number;
  label?: string;
}) {
  return (
    <div className={styles.wrap} style={{ width: size, height: size }} aria-label={label || "avatar"}>
      {src ? <img className={styles.img} src={src} alt={label || "avatar"} /> : <div className={styles.placeholder}>👤</div>}
    </div>
  );
}
