// frontend/src/app/router.tsx
import React from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";

import MasterShell from "./layout/MasterShell";
import PlayShell from "./layout/PlayShell";

import MasterLanding from "../pages/master/Landing";
import MasterSetup from "../pages/master/Setup";
import MasterLobby from "../pages/master/Lobby";
import MasterGame from "../pages/master/Game";

import PlayEnterCode from "../pages/play/EnterCode";
import PlayChoose from "../pages/play/Choose";
import PlayWait from "../pages/play/Wait";
import PlayGame from "../pages/play/Game";

export const router = createBrowserRouter([
  // Root
  { path: "/", element: <Navigate to="/master" replace /> },

  // Master
  {
    path: "/master",
    element: <MasterShell />,
    children: [
      { index: true, element: <MasterLanding /> },
      { path: "setup", element: <MasterSetup /> },
      { path: "lobby", element: <MasterLobby /> },
      { path: "game/:roomCode", element: <MasterGame /> },
    ],
  },

  // Play
  {
    path: "/play",
    element: <PlayShell />,
    children: [
      { index: true, element: <PlayEnterCode /> }, // /play (+ /play?code=AB12CD)
      { path: "choose", element: <PlayChoose /> }, // /play/choose
      { path: "wait", element: <PlayWait /> },     // /play/wait
      { path: "game/:roomCode", element: <PlayGame /> }, // /play/game/:roomCode
    ],
  },

  // Fallback
  { path: "*", element: <Navigate to="/master" replace /> },
]);
