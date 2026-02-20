import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import PlayEnter from "../pages/play/PlayEnter";
import PlayChoose from "../pages/play/PlayChoose";
import PlayWait from "../pages/play/PlayWait";

export default function PlayRoutes() {
  return (
    <Routes>
      <Route path="/play" element={<PlayEnter />} />
      <Route path="/play/choose" element={<PlayChoose />} />
      <Route path="/play/wait" element={<PlayWait />} />
      <Route path="*" element={<Navigate to="/play" replace />} />
    </Routes>
  );
}
