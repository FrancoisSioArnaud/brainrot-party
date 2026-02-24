// frontend/src/lib/api.ts
type CreateRoomRes = { room_code: string; master_key: string };

export type UploadRoomSetupBody = {
  protocol_version: number;
  seed?: string;
  senders: Array<{ sender_id: string; name: string; active: boolean; reels_count: number }>;
  rounds: unknown[];
  round_order: string[];
};

function backendHttpBase(): string {
  // If explicitly set (dev or special routing), use it
  const env = (import.meta as any).env?.VITE_BACKEND_HTTP as string | undefined;
  if (env) return env.replace(/\/+$/, "");

  // Production default: same-origin (nginx proxies /room to backend)
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

  // Try to surface structured error codes when available
  try {
    const j = JSON.parse(payloadText || "{}") as any;
    const code = j?.error;
    const msg = j?.message;
    if (code) throw new Error(`${code}${msg ? `: ${msg}` : ""}`);
  } catch {
    // ignore parse error
  }

  throw new Error(`POST /room/:code/setup failed (${res.status}) ${payloadText}`);
}
