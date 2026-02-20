const PALETTE = ["c1","c2","c3","c4","c5","c6","c7","c8","c9","c10","c11","c12"];

export function colorTokenFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
