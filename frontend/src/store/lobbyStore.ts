import { create } from "zustand";

export type LobbyPlayer = {
  id: string;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
  active: boolean;
  name: string;
  status: "free" | "connected" | "afk" | "disabled";
  photo_url: string | null;

  // AFK countdown (serveur)
  afk_seconds_left?: number | null;
  afk_expires_at_ms?: number | null;
};

type LobbyState = {
  join_code: string | null;
  master_key: string | null;
  players: LobbyPlayer[];
  readyToStart: boolean;
  setLobby: (join_code: string, master_key: string) => void;
  setPlayers: (players: LobbyPlayer[]) => void;
};

export const useLobbyStore = create<LobbyState>((set) => ({
  join_code: null,
  master_key: null,
  players: [],
  readyToStart: false,

  setLobby: (join_code, master_key) => set({ join_code, master_key }),

  setPlayers: (players) => {
    const active = players.filter((p) => p.active && p.status !== "disabled");
    const ready = active.length >= 2 && active.every((p) => p.status === "connected" || p.status === "afk");
    set({ players, readyToStart: ready });
  },
}));
