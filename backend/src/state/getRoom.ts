import type { RoomMeta, RoomRepo } from "./roomRepo.js";
import type { RoomStateInternal } from "./createRoom.js";

export async function loadRoom(repo: RoomRepo, code: string): Promise<{
  meta: RoomMeta;
  state: RoomStateInternal;
} | null> {
  const meta = await repo.getMeta(code);
  if (!meta) return null;
  const state = await repo.getState<RoomStateInternal>(code);
  if (!state) return null;
  return { meta, state };
}
