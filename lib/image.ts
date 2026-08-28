export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPTED_EXT = ['.jpeg', '.jpg', '.png', '.webp'];

/**
 * Both files together must stay under Vercel's ~4.5 MB request body cap, so each
 * one gets a 2 MB budget. Anything larger is downscaled rather than rejected -
 * phone photos are routinely 3-8 MB and rejecting them is a dead end for the user.
 */
export const TARGET_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 1600;
const QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4];

/** Returns an error message, or null when the file is usable. */
export function validateImage(file: File): string | null {
  const name = file.name.toLowerCase();
  const extOk = ACCEPTED_EXT.some((ext) => name.endsWith(ext));
  const mimeOk = ACCEPTED_MIME.includes(file.type);

  // Check both: some browsers report an empty type, some files are misnamed.
  if (!extOk && !mimeOk) {
    return 'That file type is not supported. Please choose a JPEG, JPG, PNG or WEBP image.';
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  return null;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality),
  );
}

/**
 * Shrinks an oversized image in the browser so the upload fits the request cap.
 * Files already within budget are returned untouched. If anything about the
 * canvas path fails we hand back the original and let the server decide.
 */
export async function shrinkIfNeeded(file: File): Promise<File> {
  if (file.size <= TARGET_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext('2d');
    if (!context) return file;

    // Flatten onto white first: the output is JPEG, which has no alpha channel,
    // so a transparent PNG cutout would otherwise come out on black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, quality);
      if (!blob) break;
      if (blob.size <= TARGET_BYTES) {
        const base = file.name.replace(/\.[^.]+$/, '');
        return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
      }
    }
    return file;
  } finally {
    bitmap.close();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
