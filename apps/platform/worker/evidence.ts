/**
 * Evidence images in the EVIDENCE bucket: screenshots an agent attaches with `task submit --screenshot` and the
 * platform's own captures (hooks/visual.ts). Keys live under `evidence/<system>/<realization>/<commit>/`, the prefix
 * recorded as `evaluations.evidence_key` by the visual checks that used them.
 */
import { z } from "zod";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@artyfact/semantic";
import { badRequest, HttpError } from "./errors";
import type { EvidenceImageRef } from "./hooks/contract";
import { evidencePrefix, evidenceRoot, sha256Bytes, sniffImage, type EvidenceStore } from "./hooks/visual";

/** Longest base64 text of a MAX_IMAGE_BYTES image. */
const MAX_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

export const screenshotSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mediaType: z.enum(IMAGE_TYPES),
  base64: z.string().min(1).max(MAX_BASE64).regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64"),
}).strict();
export const screenshotsSchema = z.array(screenshotSchema).max(MAX_IMAGES);
export type ScreenshotUpload = z.infer<typeof screenshotSchema>;

const extOf = (t: EvidenceImageRef["mediaType"]) => (t === "image/png" ? "png" : t === "image/jpeg" ? "jpg" : "webp");

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decoded, checked screenshots: each a real PNG/JPEG/WebP of the declared type, at most 4 MiB. Throws 400 otherwise. */
export function checkScreenshots(shots: ScreenshotUpload[]): { shot: ScreenshotUpload; bytes: Uint8Array }[] {
  if (shots.length > MAX_IMAGES) throw badRequest(`at most ${MAX_IMAGES} screenshots per submit`);
  return shots.map((shot, i) => {
    let bytes: Uint8Array;
    try {
      bytes = decode(shot.base64);
    } catch {
      throw badRequest(`screenshot ${i + 1} (${shot.name}) is not valid base64`);
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw badRequest(`screenshot ${i + 1} (${shot.name}) is ${bytes.byteLength} bytes; the limit is ${MAX_IMAGE_BYTES}`);
    const actual = sniffImage(bytes);
    if (!actual) throw badRequest(`screenshot ${i + 1} (${shot.name}) is not a PNG, JPEG or WebP image`);
    if (actual !== shot.mediaType) throw badRequest(`screenshot ${i + 1} (${shot.name}) is ${actual}, not ${shot.mediaType}`);
    return { shot, bytes };
  });
}

/**
 * Store checked screenshots under the attempt's (realization, commit) prefix. Runs before the candidate is recorded,
 * so a failed upload never leaves a candidate without the evidence its agent sent.
 */
export async function storeScreenshots(store: EvidenceStore | undefined, systemId: string, realizationId: string, commit: string, shots: ScreenshotUpload[]): Promise<EvidenceImageRef[]> {
  if (!shots.length) return [];
  const checked = checkScreenshots(shots);
  if (!store) throw new HttpError(503, "evidence-unavailable", "the platform has no evidence bucket (EVIDENCE); submit without --screenshot");
  const prefix = evidencePrefix(systemId, realizationId, commit);
  return Promise.all(checked.map(async ({ shot, bytes }, i) => {
    const sha256 = await sha256Bytes(bytes);
    const key = `${prefix}agent-${i + 1}-${sha256.slice(0, 12)}.${extOf(shot.mediaType)}`;
    await store.put(key, bytes, { httpMetadata: { contentType: shot.mediaType }, customMetadata: { source: "agent", name: shot.name, sha256 } });
    return { key, name: shot.name, mediaType: shot.mediaType, bytes: bytes.byteLength, sha256 };
  }));
}

/** An evidence image of `systemId`, or null when the key is outside its prefix or missing. */
export async function readEvidence(store: R2Bucket | undefined, systemId: string, key: string): Promise<Response | null> {
  if (!store || !key.startsWith(evidenceRoot(systemId)) || key.includes("..")) return null;
  const obj = await store.get(key);
  if (!obj) return null;
  const type = obj.httpMetadata?.contentType ?? "application/octet-stream";
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) return null;
  return new Response(obj.body, { headers: { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}
