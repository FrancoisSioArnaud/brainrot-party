import type { RoomMeta, RoomRepo } from "./roomRepo.js";
import type { RoomStateInternal } from "./createRoom.js";

function normalizeState(state: RoomStateInternal): RoomStateInternal {
  // Soft migration for older rooms: ensure avatar_url exists and is null when missing.
  if (Array.isArray(state.players)) {
    for (const p of state.players as any[]) {
      if (p && typeof p === "object") {
        if (!("avatar_url" in p) || p.avatar_url === undefined) {
          p.avatar_url = null;
        }
      }
    }
  }
  return state;
}

export async function loadRoom(
  repo: RoomRepo,
  code: string
): Promise<{ meta: RoomMeta; state: RoomStateInternal } | null> {
  const meta = await repo.getMeta(code);
  if (!meta) return null;

  const state = await repo.getState<RoomStateInternal>(code);
  if (!state) return null;

  return { meta, state: normalizeState(state) };
}
