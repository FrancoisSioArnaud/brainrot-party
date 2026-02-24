type CreateRoomRes = { room_code: string; master_key: string };

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
