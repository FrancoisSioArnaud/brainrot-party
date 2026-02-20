export function nowMs(): number {
  return Date.now();
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}
