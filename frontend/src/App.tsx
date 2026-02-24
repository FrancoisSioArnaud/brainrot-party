import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import Landing from "./pages/Landing";
import MasterSetup from "./pages/master/Setup";
import MasterLobby from "./pages/master/Lobby";
import PlayEnter from "./pages/play/Enter";

export default function App() {
  return (
    <div className="container">
      <Routes>
        <Route path="/" element={<Landing />} />

        <Route path="/master/setup" element={<MasterSetup />} />
        <Route path="/master/lobby" element={<MasterLobby />} />

        <Route path="/play" element={<PlayEnter />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
