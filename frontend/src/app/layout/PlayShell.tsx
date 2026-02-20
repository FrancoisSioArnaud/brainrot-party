import React from "react";
import { Outlet } from "react-router-dom";
import styles from "./PlayShell.module.css";
import ToastHost from "../../components/common/Toast";

export default function PlayShell() {
  return (
    <div className={styles.root}>
      <ToastHost />
      <Outlet />
    </div>
  );
}
