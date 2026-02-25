import type { SetupRound } from "./roundGen";

type CreateRoomRes = { room_code: string; master_key: string };

export class BrpApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(args: { status: number; code: string; message: string; details?: unknown }) {
    super(args.message);
    this.name = "BrpApiError";
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
  }
}

export function isBrpApiError(e: unknown): e is BrpApiError {
  return !!e && typeof e === "object" && (e as any).name === "BrpApiError" && typeof (e as any).code === "string";
}

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

async function readJsonOrText(res: Response): Promise<{ json: any | null; text: string }> {
  const text = await res.text().catch(() => "");
  if (!text) return { json: null, text: "" };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
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

  const { json, text } = await readJsonOrText(res);
  const code = json?.error;
  const msg = json?.message;

  if (typeof code === "string") {
    throw new BrpApiError({
      status: res.status,
      code,
      message: typeof msg === "string" && msg.trim() ? msg : code,
      details: json?.details,
    });
  }

  throw new Error(`POST /room/:code/setup failed (${res.status}) ${text}`);
}
