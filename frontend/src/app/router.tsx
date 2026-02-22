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
  {
    path: "/",
    element: <Navigate to="/master" replace />
  },
  {
    path: "/master",
    element: <MasterShell />,
    children: [
      { index: true, element: <MasterLanding /> },
      { path: "setup", element: <MasterSetup /> },
      { path: "lobby", element: <MasterLobby /> },
      { path: "game/:roomCode", element: <MasterGame /> }
    ]
  },
  {
    path: "/play",
    element: <PlayShell />,
    children: [
      { index: true, element: <PlayEnterCode /> },
      { path: "choose", element: <PlayChoose /> },
      { path: "wait", element: <PlayWait /> },
      { path: "game/:roomCode", element: <PlayGame /> }
    ]
  }
]);
