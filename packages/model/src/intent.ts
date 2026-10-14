import { hashOf } from "@artyfact/ontology";
import { sha256Hex } from "@artyfact/rules";
import { z } from "zod";

export type FileMap = Record<string, string>;

export interface IntentDocumentReference { path: string; hash: string }
export interface IntentNodeSource { nodeId: string; briefSections: string[]; documents: IntentDocumentReference[] }
export interface IntentManifest { version: 1; nodes: IntentNodeSource[] }
export type IntentFidelity = "checked" | "unchecked" | "missing" | "invalid";
export interface IntentDocumentStatus {
  path: string;
  declaredHash: string;
  actualHash?: string;
  status: "declared" | "verified" | "mismatch";
}
export interface IntentIssue {
  code: "missing" | "limit" | "json" | "duplicate-key" | "schema" | "unsafe-path" | "hash-mismatch" | "node" | "section";
  path: string;
  message: string;
  severity: "blocked" | "review";
}
export interface IntentSources {
  brief?: string;
  manifest?: IntentManifest;
  briefHash?: string;
  manifestHash?: string;
  hash: string;
  issues: IntentIssue[];
  fidelity: IntentFidelity;
  documents: IntentDocumentStatus[];
}

export const INTENT_BRIEF_PATH = "intent/brief.md";
export const INTENT_MANIFEST_PATH = "intent/manifest.json";
export const INTENT_BRIEF_MAX_BYTES = 64 * 1024;
export const INTENT_MANIFEST_MAX_BYTES = 128 * 1024;

const utf8Bytes = (text: string): number => {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

const safeRepoPath = (path: string): boolean => {
  if (!path || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false;
  const parts = path.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
};

const documentSchema = z.strictObject({
  path: z.string().min(1),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
const nodeSchema = z.strictObject({
  nodeId: z.string().regex(/^[A-Za-z0-9][\w.-]{0,199}$/),
  briefSections: z.array(z.string().min(1).max(200)).min(1).max(128),
  documents: z.array(documentSchema).max(128),
});
const manifestSchema = z.strictObject({
  version: z.literal(1),
  nodes: z.array(nodeSchema).min(1).max(4096),
}).superRefine((manifest, context) => {
  const seen = new Set<string>();
  for (let index = 0; index < manifest.nodes.length; index++) {
    const node = manifest.nodes[index]!;
    if (seen.has(node.nodeId)) context.addIssue({ code: "custom", path: ["nodes", index, "nodeId"], message: `duplicate nodeId ${node.nodeId}` });
    seen.add(node.nodeId);
  }
});

/** A tiny JSON scanner used before JSON.parse because JSON.parse silently keeps the last duplicate object key. */
function duplicateKeys(text: string): string[] {
  let offset = 0;
  const duplicates: string[] = [];
  const whitespace = () => { while (/\s/.test(text[offset] ?? "")) offset++; };
  const string = (): string => {
    whitespace();
    if (text[offset] !== '"') throw new Error("expected string");
    const start = offset++;
    while (offset < text.length) {
      if (text[offset] === "\\") { offset += 2; continue; }
      if (text[offset++] === '"') return JSON.parse(text.slice(start, offset)) as string;
    }
    throw new Error("unterminated string");
  };
  const value = (path: string): void => {
    whitespace();
    if (text[offset] === "{") {
      offset++;
      const seen = new Set<string>();
      whitespace();
      if (text[offset] === "}") { offset++; return; }
      while (offset < text.length) {
        const key = string();
        if (seen.has(key)) duplicates.push(path ? `${path}.${key}` : key);
        seen.add(key);
        whitespace();
        if (text[offset++] !== ":") throw new Error("expected colon");
        value(path ? `${path}.${key}` : key);
        whitespace();
        if (text[offset] === "}") { offset++; return; }
        if (text[offset++] !== ",") throw new Error("expected comma");
      }
      throw new Error("unterminated object");
    }
    if (text[offset] === "[") {
      offset++;
      whitespace();
      if (text[offset] === "]") { offset++; return; }
      let index = 0;
      while (offset < text.length) {
        value(`${path}[${index++}]`);
        whitespace();
        if (text[offset] === "]") { offset++; return; }
        if (text[offset++] !== ",") throw new Error("expected comma");
      }
      throw new Error("unterminated array");
    }
    if (text[offset] === '"') { string(); return; }
    const start = offset;
    while (offset < text.length && !/[\s,}\]]/.test(text[offset]!)) offset++;
    if (start === offset) throw new Error("expected value");
    JSON.parse(text.slice(start, offset));
  };
  value("");
  whitespace();
  if (offset !== text.length) throw new Error("unexpected trailing input");
  return duplicates;
}

const issue = (code: IntentIssue["code"], path: string, message: string, severity: IntentIssue["severity"] = "blocked"): IntentIssue =>
  ({ code, path, message, severity });

/** Reads the two allowlisted intent sidecars. It never interprets Markdown as instructions. */
export function readIntentSources(files: FileMap): IntentSources {
  const brief = files[INTENT_BRIEF_PATH];
  const rawManifest = files[INTENT_MANIFEST_PATH];
  const issues: IntentIssue[] = [];
  const documents: IntentDocumentStatus[] = [];
  let manifest: IntentManifest | undefined;

  if (brief === undefined) issues.push(issue("missing", INTENT_BRIEF_PATH, "intent brief was not supplied", "review"));
  else if (utf8Bytes(brief) > INTENT_BRIEF_MAX_BYTES) issues.push(issue("limit", INTENT_BRIEF_PATH, "intent brief exceeds 64 KiB"));
  else if (brief.trim() === "") issues.push(issue("schema", INTENT_BRIEF_PATH, "intent brief must contain meaningful text"));

  if (rawManifest === undefined) issues.push(issue("missing", INTENT_MANIFEST_PATH, "intent manifest was not supplied", "review"));
  else if (utf8Bytes(rawManifest) > INTENT_MANIFEST_MAX_BYTES) issues.push(issue("limit", INTENT_MANIFEST_PATH, "intent manifest exceeds 128 KiB"));
  else {
    try {
      const duplicates = duplicateKeys(rawManifest);
      if (duplicates.length) {
        for (const path of duplicates) issues.push(issue("duplicate-key", INTENT_MANIFEST_PATH, `duplicate JSON key ${path}`));
      } else {
        const raw: unknown = JSON.parse(rawManifest);
        const parsed = manifestSchema.safeParse(raw);
        if (!parsed.success) {
          for (const problem of parsed.error.issues) issues.push(issue("schema", INTENT_MANIFEST_PATH, `${problem.path.join(".") || "manifest"}: ${problem.message}`));
        } else {
          manifest = parsed.data;
          for (const node of manifest.nodes) for (const document of node.documents) {
            if (!safeRepoPath(document.path)) issues.push(issue("unsafe-path", INTENT_MANIFEST_PATH, `unsafe document path ${JSON.stringify(document.path)}`));
            else {
              const source = files[document.path];
              const actualHash = source === undefined ? undefined : `sha256:${sha256Hex(source)}`;
              const status = actualHash === undefined ? "declared" : actualHash === document.hash ? "verified" : "mismatch";
              documents.push({ path: document.path, declaredHash: document.hash, ...(actualHash !== undefined && { actualHash }), status });
              if (status === "mismatch") issues.push(issue("hash-mismatch", INTENT_MANIFEST_PATH, `document hash mismatch for ${document.path}`));
            }
          }
        }
      }
    } catch (error) {
      issues.push(issue("json", INTENT_MANIFEST_PATH, `invalid JSON: ${(error as Error).message}`));
    }
  }

  const blocked = issues.some((entry) => entry.severity === "blocked");
  const fidelity: IntentFidelity = blocked ? "invalid" : brief === undefined || rawManifest === undefined ? "missing" : "unchecked";
  const briefHash = brief === undefined ? undefined : `sha256:${sha256Hex(brief)}`;
  const manifestHash = manifest === undefined ? undefined : `sha256:${hashOf(manifest)}`;
  return {
    ...(brief !== undefined && { brief }),
    ...(manifest !== undefined && { manifest }),
    ...(briefHash !== undefined && { briefHash }),
    ...(manifestHash !== undefined && { manifestHash }),
    hash: `sha256:${hashOf({ briefHash: briefHash ?? null, manifestHash: manifestHash ?? null })}`,
    issues,
    fidelity,
    documents,
  };
}
