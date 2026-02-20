import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PlaySession = {
  join_code: string | null;
  device_id: string;
  player_id: string | null;
  player_session_token: string | null;
  kicked_message: string | null;
  lobby_closed_reason: string | null;
};

function uuidv4() {
  // Simple UUID fallback (suffisant MVP)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const usePlayStore = create<PlaySession & {
  setJoinCode: (code: string) => void;
  clearJoin: () => void;
  setClaim: (player_id: string, token: string) => void;
  clearClaim: () => void;
  setKicked: (msg: string | null) => void;
  setLobbyClosed: (reason: string | null) => void;
}>()(
  persist(
    (set, get) => ({
      join_code: null,
      device_id: uuidv4(),
      player_id: null,
      player_session_token: null,
      kicked_message: null,
      lobby_closed_reason: null,

      setJoinCode: (code) => set({ join_code: code.toUpperCase(), kicked_message: null, lobby_closed_reason: null }),
      clearJoin: () => set({ join_code: null, player_id: null, player_session_token: null }),
      setClaim: (player_id, token) => set({ player_id, player_session_token: token, kicked_message: null }),
      clearClaim: () => set({ player_id: null, player_session_token: null }),
      setKicked: (msg) => set({ kicked_message: msg }),
      setLobbyClosed: (reason) => set({ lobby_closed_reason: reason })
    }),
    { name: "brp_play_v1" }
  )
);
