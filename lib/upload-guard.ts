/**
 * Server-side validation for the proxy route. The client already validates and
 * downscales, but a client check is only a convenience: anything reaching
 * /api/tryon may have been crafted by hand, so every limit is re-applied here.
 */

/** Per file. The client targets 2 MB; this leaves headroom without inviting abuse. */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
/** Both files together, under Vercel's ~4.5 MB body cap. */
export const MAX_TOTAL_BYTES = 6 * 1024 * 1024;

type Signature = { ext: string; mime: string; test: (b: Uint8Array) => boolean };

/**
 * Magic-byte signatures. Content type from the client is attacker-controlled, so
 * the real bytes decide. SVG is deliberately absent: it is XML that can carry
 * script, and it must never be treated as an image by this route.
 */
const SIGNATURES: Signature[] = [
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'png',
    mime: 'image/png',
    test: (b) =>
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    test: (b) =>
      // "RIFF" .... "WEBP"
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/** Response content types the proxy is willing to hand back to a browser. */
export const ALLOWED_RESPONSE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type CheckedFile = { blob: Blob; filename: string };

/**
 * Confirms the bytes really are one of the allowed raster formats and returns a
 * blob with a server-chosen name and type. The original filename is discarded
 * rather than sanitised: nothing downstream needs it, and forwarding a
 * client-controlled string into a multipart header is an avoidable risk.
 */
export async function checkImage(
  file: File,
  field: string,
): Promise<{ ok: true; value: CheckedFile } | { ok: false; error: string }> {
  if (file.size === 0) {
    return { ok: false, error: `${field} is empty.` };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `${field} is larger than the ${Math.round(
        MAX_FILE_BYTES / (1024 * 1024),
      )} MB limit.`,
    };
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const match = SIGNATURES.find((signature) => signature.test(head));

  if (!match) {
    return {
      ok: false,
      error: `${field} is not a JPEG, PNG or WEBP image.`,
    };
  }

  return {
    ok: true,
    value: {
      blob: new Blob([await file.arrayBuffer()], { type: match.mime }),
      filename: `${field}.${match.ext}`,
    },
  };
}
