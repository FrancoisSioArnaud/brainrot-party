type CreateRoomRes = { room_code: string; master_key: string };

function backendHttpBase(): string {
  // if you set VITE_BACKEND_HTTP, use it. else same host on :3010.
  const env = (import.meta as any).env?.VITE_BACKEND_HTTP as string | undefined;
  if (env) return env;

  const { protocol, hostname } = window.location;
  const isHttps = protocol === "https:";
  return `${isHttps ? "https" : "http"}://${hostname}:3010`;
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
