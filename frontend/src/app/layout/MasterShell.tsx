import React from "react";
import { Outlet } from "react-router-dom";
import styles from "./MasterShell.module.css";
import ToastHost from "../../components/common/Toast";

export default function MasterShell() {
  return (
    <div className={styles.root}>
      <ToastHost />
      <Outlet />
    </div>
  );
}
