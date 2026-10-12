/** Git pkt-line framing (https://git-scm.com/docs/protocol-common#_pkt_line_format) and side-band demux. */
import { concatBytes } from "./objects";

const enc = new TextEncoder();
const dec = new TextDecoder();

export const FLUSH = enc.encode("0000");
const MAX_PKT = 65520;

export function pkt(data: string | Uint8Array): Uint8Array {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  if (bytes.length + 4 > MAX_PKT) throw new Error(`pkt-line payload of ${bytes.length} bytes exceeds ${MAX_PKT - 4}`);
  return concatBytes([enc.encode((bytes.length + 4).toString(16).padStart(4, "0")), bytes]);
}

/**
 * Split a pkt-line stream: payloads as bytes, flush (`0000`) as null. Delim/response-end packets (`0001`/`0002`)
 * are also returned as null. Stops at the first malformed length, returning what came before plus the rest.
 */
export function parsePkts(bytes: Uint8Array): { pkts: (Uint8Array | null)[]; rest: Uint8Array } {
  const pkts: (Uint8Array | null)[] = [];
  let i = 0;
  while (i + 4 <= bytes.length) {
    const lenText = dec.decode(bytes.subarray(i, i + 4));
    if (!/^[0-9a-f]{4}$/.test(lenText)) break;
    const len = parseInt(lenText, 16);
    if (len < 4) { pkts.push(null); i += 4; continue; }
    if (i + len > bytes.length) break;
    pkts.push(bytes.subarray(i + 4, i + len));
    i += len;
  }
  return { pkts, rest: bytes.subarray(i) };
}

/** A payload as text without its trailing newline. */
export const pktText = (p: Uint8Array) => dec.decode(p).replace(/\n$/, "");

/** Side-band channels: 1 = data, 2 = progress, 3 = fatal error. Packets before a flush only. */
export function demuxSideband(pkts: (Uint8Array | null)[]): { data: Uint8Array; progress: string; error: string } {
  const data: Uint8Array[] = [];
  let progress = "", error = "";
  for (const p of pkts) {
    if (!p || !p.length) continue;
    const body = p.subarray(1);
    if (p[0] === 1) data.push(body);
    else if (p[0] === 2) progress += dec.decode(body);
    else if (p[0] === 3) error += dec.decode(body);
  }
  return { data: concatBytes(data), progress, error };
}
