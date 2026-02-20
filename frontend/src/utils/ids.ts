import { v4 as uuidv4 } from "uuid";

export function uuid(): string {
  return uuidv4();
}

export function getOrCreateDeviceId(): string {
  const key = "brp_device_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = uuidv4();
  localStorage.setItem(key, id);
  return id;
}
