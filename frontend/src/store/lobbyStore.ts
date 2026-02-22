import { create } from "zustand";

export type LobbyPlayerStatus =
  // cible
  | "free"
  | "taken"
  | "disabled"
  // compat legacy (au cas où un serveur ancien renvoie encore ça)
  | "connected"
  | "afk";

export type LobbyPlayer = {
  id: string;
  type: "sender_linked" | "manual";
  sender_id_local: string | null;
  active: boolean;
  name: string;
  status: LobbyPlayerStatus;
  photo_url: string | null;

  // Compat legacy (plus utilisé)
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
    // ✅ règle: actif + non disabled
    const active = players.filter((p) => p.active && p.status !== "disabled");

    // ✅ règle: prêt si >=2 et tous "pris" (pas free)
    // (status "taken" ou "connected" legacy comptent comme pris)
    const ready = active.length >= 2 && active.every((p) => p.status !== "free");

    set({ players, readyToStart: ready });
  },
}));
