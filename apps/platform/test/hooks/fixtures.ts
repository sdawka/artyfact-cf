/// <reference types="vite/client" />
import type { FileMap } from "../../worker/hooks/contract";

const raw = import.meta.glob("../fixtures/mini-genome/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PREFIX = "../fixtures/mini-genome/";

/** Fresh copy of the mini-Genome file map (Genome-relative paths). */
export function miniGenome(): FileMap {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.slice(PREFIX.length), v]));
}

/** Mini-Genome with `entity.ContactRecord` gaining a `recipients` list of accounts (topology.recipientArray). */
export function withRecipients(files: FileMap = miniGenome()): FileMap {
  const path = "thing.webapp/section.domain/entity.ContactRecord/node.yaml";
  const out = { ...files };
  out[path] = files[path].replace(
    "    - name: name\n      type: text\n      optional: false\n",
    "    - name: name\n      type: text\n      optional: false\n    - name: recipients\n      type: list<ref:entity.Account>\n",
  );
  if (out[path] === files[path]) throw new Error("fixture mutation did not apply");
  return out;
}

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";
export const BASE = "fedcba9876543210fedcba9876543210fedcba98";

const kitRaw = import.meta.glob("../../../../examples/keep-in-touch-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const KIT_PREFIX = "../../../../examples/keep-in-touch-system/";

/** Fresh copy of the real Keep in Touch Genome file map. */
export function keepInTouch(): FileMap {
  return Object.fromEntries(Object.entries(kitRaw).map(([k, v]) => [k.slice(KIT_PREFIX.length), v]));
}

/** Keep in Touch with `cardinality: many` on operation.contact.save (writes ContactRecord, which has an Account ref). */
export function keepInTouchMany(files: FileMap = keepInTouch()): FileMap {
  const path = "thing.webapp/section.domain/operation.contact.save/node.yaml";
  const out = { ...files };
  out[path] = files[path].replace("  name: Create or edit private contact\n", "  name: Create or edit private contact\n  cardinality: many\n");
  if (out[path] === files[path]) throw new Error("fixture mutation did not apply");
  return out;
}
