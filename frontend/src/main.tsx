import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import "./index.css";

// Master pages
import MasterSetup from "./pages/master/Setup";
import MasterLobby from "./pages/master/Lobby";

// Play pages
import PlayEnter from "./pages/play/PlayEnter";
import PlayChoose from "./pages/play/PlayChoose";
import PlayWait from "./pages/play/PlayWait";

// (optionnel) landing
import MasterHome from "./pages/master/Home"; // si tu l’as
// si tu n’as pas MasterHome, remplace par un composant minimal ci-dessous.

function FallbackHome() {
  return (
    <div style={{ padding: 18 }}>
      <h1 style={{ marginTop: 0 }}>Brainrot Party</h1>
      <div style={{ color: "var(--muted)", fontWeight: 800 }}>
        /master/setup pour démarrer en Master — /play pour rejoindre en mobile.
      </div>
    </div>
  );
}

const RootHome = (MasterHome as any) ? (MasterHome as any) : FallbackHome;

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

        {/* Play */}
        <Route path="/play" element={<PlayEnter />} />
        <Route path="/play/choose" element={<PlayChoose />} />
        <Route path="/play/wait" element={<PlayWait />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
