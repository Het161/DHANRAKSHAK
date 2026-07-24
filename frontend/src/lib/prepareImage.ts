/**
 * Client-side screenshot preprocessing before upload.
 *
 * A 4MB phone PNG becomes a ~200-400KB JPEG with the text still fully readable,
 * which is the single biggest win for OCR on a 0.1 vCPU server: less to upload,
 * less to decode, fewer pixels to recognise. Re-encoding through a canvas also
 * strips all metadata (EXIF, location) - only the pixels leave the device.
 */

// Kept at 1400 (not 1600): OCR on the free-tier 0.1 vCPU is pixel-bound, and a
// tall screenshot at 1600px overran the budget. Text stays readable at 1400.
const MAX_EDGE = 1400;
const JPEG_QUALITY = 0.8;
// A belt-and-braces cap; the user-facing 10MB gate is validateImage(), before run().
const MAX_ORIGINAL_BYTES = 10 * 1024 * 1024;

export interface PreparedImage {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

async function decode(file: File): Promise<{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; width: number; height: number; done: () => void }> {
  // createImageBitmap honours EXIF orientation and decodes off the main thread.
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      done: () => bitmap.close(),
    };
  }
  // Fallback for older webviews.
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("could not decode image"));
    img.src = url;
  });
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    done: () => URL.revokeObjectURL(url),
  };
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error("image too large");

  const source = await decode(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    source.draw(ctx, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("could not encode image");
    return { blob, filename: "screenshot.jpg", width, height };
  } finally {
    source.done();
  }
}
