import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// import "./index.css";

import RootHome from "./pages/master/Landing";
import MasterSetup from "./pages/master/Setup";
import MasterLobby from "./pages/master/Lobby";
import MasterGame from "./pages/master/Game";

import PlayEnter from "./pages/play/EnterCode";
import PlayChoose from "./pages/play/Choose";
import PlayWait from "./pages/play/Wait";

// If you have a PlayGame page already, keep this import.
// If not, create it or temporarily comment this route.
import PlayGame from "./pages/play/Game";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Home */}
        <Route path="/" element={<RootHome />} />

        {/* Master */}
        <Route path="/master" element={<RootHome />} />
        <Route path="/master/setup" element={<MasterSetup />} />
        <Route path="/master/lobby" element={<MasterLobby />} />
        <Route path="/master/game/:roomCode" element={<MasterGame />} />

        {/* Play */}
        <Route path="/play" element={<PlayEnter />} />
        <Route path="/play/choose" element={<PlayChoose />} />
        <Route path="/play/wait" element={<PlayWait />} />
        <Route path="/play/game/:roomCode" element={<PlayGame />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
