import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";

import Landing from "./pages/Landing";

import MasterSetup from "./pages/master/Setup";
import MasterLobby from "./pages/master/Lobby";
import MasterGame from "./pages/master/Game";

import PlayEnter from "./pages/play/Enter";
import PlayGame from "./pages/play/Game";

export default function App() {
  const { pathname } = useLocation();
  const fullBleed = pathname.startsWith("/master/game") || pathname.startsWith("/play/game");

  return (
    <div className={fullBleed ? "container gameContainer" : "container"}>
      <Routes>
        <Route path="/" element={<Landing />} />

        <Route path="/master/setup" element={<MasterSetup />} />
        <Route path="/master/lobby" element={<MasterLobby />} />
        <Route path="/master/game" element={<MasterGame />} />

        <Route path="/play" element={<PlayEnter />} />
        <Route path="/play/game" element={<PlayGame />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
