/**
 * Packfile v2 writer: undeltified objects only (no thin packs, no OFS/REF deltas), each zlib-deflated with
 * `CompressionStream("deflate")`, followed by the SHA-1 of everything before it.
 */
import { concatBytes, sha1Bytes, type GitObject, type ObjectType } from "./objects";

const TYPE_CODE: Record<ObjectType, number> = { commit: 1, tree: 2, blob: 3 };

/** The per-object header: type in bits 4-6 of the first byte, size as a little-endian base-128 varint. */
export function objectHeader(type: ObjectType, size: number): Uint8Array {
  const out: number[] = [];
  let byte = (TYPE_CODE[type] << 4) | (size & 0x0f);
  size = Math.floor(size / 16);
  while (size > 0) {
    out.push(byte | 0x80);
    byte = size & 0x7f;
    size = Math.floor(size / 128);
  }
  out.push(byte);
  return new Uint8Array(out);
}

/** zlib (RFC 1950) stream of `data`. */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function buildPack(objects: GitObject[]): Promise<Uint8Array> {
  const header = new Uint8Array(12);
  header.set([0x50, 0x41, 0x43, 0x4b]); // "PACK"
  const view = new DataView(header.buffer);
  view.setUint32(4, 2);
  view.setUint32(8, objects.length);
  const parts: Uint8Array[] = [header];
  for (const o of objects) parts.push(objectHeader(o.type, o.body.length), await deflate(o.body));
  const body = concatBytes(parts);
  return concatBytes([body, await sha1Bytes(body)]);
}
