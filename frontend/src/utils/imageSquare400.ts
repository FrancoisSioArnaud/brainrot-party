export async function squareResize400(file: File): Promise<Blob> {
  const img = await loadImageFromFile(file);

  const size = Math.min(img.width, img.height);
  const sx = Math.floor((img.width - size) / 2);
  const sy = Math.floor((img.height - size) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas");

  ctx.drawImage(img, sx, sy, size, size, 0, 0, 400, 400);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error("toBlob_failed"));
      else resolve(b);
    }, "image/jpeg", 0.82);
  });

  return blob;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_load_failed"));
    };
    img.src = url;
  });
}
