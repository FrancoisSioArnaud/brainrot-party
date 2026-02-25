import type { SetupRound } from "./roundGen";

type CreateRoomRes = { room_code: string; master_key: string };

export type UploadRoomSetupBody = {
  protocol_version: number;
  seed: string;
  k_max: number;
  senders: Array<{ sender_id: string; name: string; active: boolean; reels_count: number }>;
  rounds: SetupRound[];
  round_order: string[];
  metrics: Record<string, unknown>;
};

function backendHttpBase(): string {
  const env = (import.meta as any).env?.VITE_BACKEND_HTTP as string | undefined;
  if (env) return env.replace(/\/+$/, "");
  return "";
}

export async function createRoom(): Promise<CreateRoomRes> {
  const base = backendHttpBase();
  const res = await fetch(`${base}/room`, { method: "POST" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`POST /room failed (${res.status}) ${txt}`);
  }
  return (await res.json()) as CreateRoomRes;
}

export async function uploadRoomSetup(
  room_code: string,
  master_key: string,
  body: UploadRoomSetupBody
): Promise<void> {
  const base = backendHttpBase();
  const res = await fetch(`${base}/room/${encodeURIComponent(room_code)}/setup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-master-key": master_key,
    },
    body: JSON.stringify(body),
  });

  if (res.ok) return;

  let payloadText = "";
  try {
    payloadText = await res.text();
  } catch {
    payloadText = "";
  }

  try {
    const j = JSON.parse(payloadText || "{}") as any;
    const code = j?.error;
    const msg = j?.message;
    if (code) throw new Error(`${code}${msg ? `: ${msg}` : ""}`);
  } catch {
    // ignore
  }

  throw new Error(`POST /room/:code/setup failed (${res.status}) ${payloadText}`);
}
