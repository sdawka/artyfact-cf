import { sha256Hex } from "@artyfact/rules";

/** Canonical JSON with sorted keys and undefined members dropped. */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export const hashOf = (v: unknown): string => sha256Hex(canon(v));

export const byKey = <T>(key: (x: T) => string) => (a: T, b: T): number => {
  const x = key(a), y = key(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
