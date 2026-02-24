import React from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";

import MasterLanding from "./pages/master/Landing";
import MasterLobby from "./pages/master/Lobby";
import PlayEnter from "./pages/play/Enter";

export default function App() {
  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <Link to="/master" className="btn">Master</Link>
          <Link to="/play" className="btn">Play</Link>
        </div>
        <div className="small mono">Brainrot Party</div>
      </div>

      <Routes>
        <Route path="/" element={<Navigate to="/master" replace />} />

        <Route path="/master" element={<MasterLanding />} />
        <Route path="/master/lobby" element={<MasterLobby />} />

        <Route path="/play" element={<PlayEnter />} />

        <Route path="*" element={<div className="card">404</div>} />
      </Routes>
    </div>
  );
}
