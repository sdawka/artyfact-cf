/**
 * Visual checks: a criterion's claim judged from screenshots by a System One provider that reads images (Cloudflare
 * Clef through the `AI` binding; the fake in tests). Two sources, labelled image by image:
 *
 *  - platform: Browser Run's screenshot Quick Action (`BROWSER.quickAction("screenshot")`) of the candidate's
 *    validated previewUrl + `inputs.path`, at a desktop and a mobile viewport (`inputs.viewports`), optionally after
 *    `inputs.waitFor` (a CSS selector) appears. Captures are kept in the evidence bucket beside the agent's.
 *  - agent: screenshots the implementing agent attached with `task submit --screenshot` (CandidateRef.screenshots),
 *    read back from the evidence bucket.
 *
 * Images go to the judgment in batches Clef accepts (at most 4, 8 MiB together); any batch failing fails the check,
 * all passing passes it, anything else is unknown. Without a provider that reads images, or without any image, the
 * check is `not-run` with the reason; it is never judged from text alone. The one exception is the hosted demo
 * (`simulated`): it captures and reads nothing and records a canned verdict, labelled simulated, from the fake.
 */
import type { schema, SystemModel } from "@artyfact/model";
import { MAX_IMAGE_BYTES, MAX_IMAGES, MAX_TOTAL_IMAGE_BYTES, safeLabel, visualCriterion, visualQuestions, visualState, type S1Image, type S1ImageType, type SystemOne, type VisualImageLabel, type VisualResult } from "@artyfact/semantic";
import type { CandidateRef, EvidenceImageRef } from "./contract";
import { validatePreviewUrl, type PreviewPolicy } from "./http-health";
import { notRun, type Outcome } from "./provenance";

/** The slice of the Browser Run binding used here (tests pass a mock of `quickAction("screenshot")`). */
export type BrowserLike = Pick<BrowserRun, "quickAction">;

/** The slice of an R2 bucket used for evidence images. */
export interface EvidenceStore {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
}

/** Paid asks one visual check may make; a set needing more batches is not-run rather than partly judged. */
export const MAX_ASKS = 3;
/** Why agent screenshots alone never pass a visual check. */
export const UNVERIFIED = "agent screenshots are unverified; a pass needs a platform capture of the validated preview";

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

/** One image sent to the judgment. */
interface Shot { source: "platform" | "agent"; label: string; image: S1Image; bytes: number; key?: string }

export interface VisualInput {
  systemId: string;
  candidate: CandidateRef;
  criterion: schema.Criterion;
  hook: schema.AssayHook;
  model: SystemModel;
  s1: SystemOne;
  policy: PreviewPolicy;
  browser?: BrowserLike;
  evidence?: EvidenceStore;
  /** Hosted demo: no capture, no evidence read, no paid call; `s1` is the simulated provider. */
  simulated?: boolean;
}

/** Why a hosted-demo visual verdict is not a judgment. */
export const SIMULATED = "Hosted demo: simulated verdict. No screenshot was captured or judged; run Artyfact locally on your Cloudflare account for Clef";

/** The hosted demo's visual check: the simulated provider's canned answer on the claim alone, labelled as such. */
async function simulatedCheck(input: VisualInput): Promise<Outcome> {
  const c = input.criterion, node = input.model.index.byId[c.subjectId];
  const v = {
    criterion: { id: c.id, title: c.title, claim: c.claim },
    subject: { id: c.subjectId, ...(node?.kind && { kind: node.kind }), ...(node?.name && { name: node.name }) },
    page: { path: input.hook.inputs.path ?? "/" }, images: [],
  };
  const reply = await input.s1.ask(visualState(v), visualQuestions(v));
  const a = reply.answers.satisfies;
  const p = a?.type === "noul" ? a.noul : 0.5;
  const verdict = p >= 0.9 ? "pass" : p <= 0.1 ? "fail" : "unknown";
  return {
    execution: "completed",
    verdict,
    observations: [{ simulated: true, satisfies: p, verdict }],
    interpretation: `Simulated ${verdict} for "${c.title}" (hosted demo).`,
    limitations: [`${SIMULATED}.`],
    provenance: { provider: reply.provider ?? "simulated", model: reply.model, images: "0", sources: "simulated", simulated: "hosted-demo" },
  };
}

const seg = (s: string) => encodeURIComponent(s).replace(/%/g, "_");

/** Every evidence image of a System lives under this prefix. */
export const evidenceRoot = (systemId: string) => `evidence/${seg(systemId)}/`;
/** Where a candidate's evidence images live: one prefix per (System, realization, commit). */
export const evidencePrefix = (systemId: string, realizationId: string, commit: string) => `${evidenceRoot(systemId)}${seg(realizationId)}/${seg(commit)}/`;

export async function sha256Bytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** The image type the magic bytes declare, or null when the bytes are not PNG, JPEG or WebP. */
export function sniffImage(b: Uint8Array): S1ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

const extOf = (t: S1ImageType) => (t === "image/png" ? "png" : t === "image/jpeg" ? "jpg" : "webp");

export function viewportsOf(inputs: Record<string, string>): ViewportName[] {
  const raw = (inputs.viewports ?? "desktop,mobile").split(",").map((s) => s.trim()).filter(Boolean);
  const names = raw.filter((v): v is ViewportName => v in VIEWPORTS);
  return names.length ? [...new Set(names)] : ["desktop", "mobile"];
}

/** Split images into the batches Clef accepts: at most 4 per ask and 8 MiB together. */
export function batches<T extends { bytes: number }>(xs: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const x of xs) {
    if (cur.length && (cur.length >= MAX_IMAGES || size + x.bytes > MAX_TOTAL_IMAGE_BYTES)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(x);
    size += x.bytes;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The capture URL: previewUrl + inputs.path on the preview's origin, or why there is none. */
function captureUrl(input: VisualInput): { url: string } | { reason: string } {
  const { previewUrl } = input.candidate;
  if (!previewUrl) return { reason: "no previewUrl was submitted with this candidate" };
  const check = validatePreviewUrl(previewUrl, input.policy);
  if (!check.ok) return { reason: `previewUrl rejected: ${check.reason}` };
  const base = new URL(check.url.href.replace(/\/+$/, "") + "/");
  const target = new URL((input.hook.inputs.path ?? "/").replace(/^\/+/, ""), base);
  if (target.origin !== check.url.origin) return { reason: "inputs.path leaves the preview origin" };
  return { url: `${target.origin}${target.pathname}${target.search}` };
}

async function capture(input: VisualInput, url: string, viewport: ViewportName, notes: string[]): Promise<Shot | null> {
  const navMs = Math.max(5_000, Math.min(30_000, Math.floor(input.hook.timeoutMs / 2)));
  const waitFor = input.hook.inputs.waitFor?.trim();
  let res: Response;
  try {
    res = await input.browser!.quickAction("screenshot", {
      url,
      viewport: VIEWPORTS[viewport],
      screenshotOptions: { type: "jpeg", quality: 80 },
      gotoOptions: { waitUntil: "networkidle2", timeout: navMs },
      ...(waitFor && { waitForSelector: { selector: waitFor, visible: true, timeout: navMs } }),
      cacheTTL: 0,
    });
  } catch (e) {
    notes.push(`${viewport} capture failed: ${(e as Error)?.message?.slice(0, 200) ?? String(e)}`);
    return null;
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    notes.push(`${viewport} capture failed: Browser Run HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mediaType = sniffImage(bytes);
  if (!mediaType) {
    notes.push(`${viewport} capture failed: Browser Run did not return an image`);
    return null;
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    notes.push(`${viewport} capture is ${bytes.byteLength} bytes, over the ${MAX_IMAGE_BYTES}-byte image limit; not judged`);
    return null;
  }
  const sha256 = await sha256Bytes(bytes);
  const { width, height } = VIEWPORTS[viewport];
  let key: string | undefined;
  if (input.evidence) {
    const k = `${evidencePrefix(input.systemId, input.candidate.realizationId, input.candidate.commit)}capture-${seg(input.hook.id)}-${viewport}.${extOf(mediaType)}`;
    try {
      await input.evidence.put(k, bytes, { httpMetadata: { contentType: mediaType }, customMetadata: { source: "platform", url, viewport, sha256 } });
      key = k;
    } catch (e) {
      notes.push(`${viewport} capture was judged but not stored: ${(e as Error)?.message?.slice(0, 200) ?? String(e)}`);
    }
  }
  return { source: "platform", label: `${viewport} ${width}x${height} capture of ${url}`, image: { mediaType, base64: toBase64(bytes), sha256 }, bytes: bytes.byteLength, ...(key && { key }) };
}

async function agentShot(store: EvidenceStore, ref: EvidenceImageRef, notes: string[]): Promise<Shot | null> {
  try {
    const obj = await store.get(ref.key);
    if (!obj) {
      notes.push(`agent screenshot ${ref.name} is missing from the evidence bucket`);
      return null;
    }
    const bytes = new Uint8Array(await obj.arrayBuffer());
    // Checked again on the bytes actually read, never on the ref's recorded size or type.
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      notes.push(`agent screenshot ${safeLabel(ref.name)} is ${bytes.byteLength} bytes, over the ${MAX_IMAGE_BYTES}-byte image limit; not judged`);
      return null;
    }
    const actual = sniffImage(bytes);
    if (actual !== ref.mediaType) {
      notes.push(`agent screenshot ${safeLabel(ref.name)} is not the ${ref.mediaType} image it was recorded as; not judged`);
      return null;
    }
    return { source: "agent", label: `agent screenshot ${safeLabel(ref.name)}`, image: { mediaType: ref.mediaType, base64: toBase64(bytes), sha256: ref.sha256 }, bytes: bytes.byteLength, key: ref.key };
  } catch (e) {
    notes.push(`agent screenshot ${ref.name} could not be read: ${(e as Error)?.message?.slice(0, 200) ?? String(e)}`);
    return null;
  }
}

export async function visualCheck(input: VisualInput): Promise<Outcome> {
  const { s1, candidate: cand, criterion: c } = input;
  if (!s1.images) {
    const why = s1.mode === "off" ? (s1.reason ? `System One is off (${s1.reason})` : "System One is off") : `System One provider ${s1.model} cannot read images`;
    return notRun(`${why}; visual checks need Cloudflare Clef (the Workers AI binding AI).`, { provenance: { provider: s1.mode === "off" ? "off" : s1.model, model: s1.model } });
  }
  if (input.simulated) return simulatedCheck(input);
  const notes: string[] = [];
  const shots: Shot[] = [];

  const target = captureUrl(input);
  if ("reason" in target) notes.push(`No platform capture: ${target.reason}.`);
  else if (!input.browser) notes.push("No platform capture: the Browser Run binding BROWSER is not configured.");
  else for (const v of viewportsOf(input.hook.inputs)) {
    const shot = await capture(input, target.url, v, notes);
    if (shot) shots.push(shot);
  }

  const refs = cand.screenshots ?? [];
  // Only the candidate's own prefix, re-derived here: a manifest can never point a check at another System's,
  // realization's or commit's images.
  const own = evidencePrefix(input.systemId, cand.realizationId, cand.commit);
  const inside = refs.filter((r) => typeof r.key === "string" && r.key.startsWith(own) && !r.key.slice(own.length).includes("/") && !/\.\.|%/.test(r.key));
  if (inside.length < refs.length) notes.push(`${refs.length - inside.length} agent screenshot(s) outside this candidate's evidence prefix were not read.`);
  if (inside.length > MAX_IMAGES) return notRun(`The candidate lists ${inside.length} agent screenshots; at most ${MAX_IMAGES} are accepted.`, { provenance: { provider: "none", model: s1.model } });
  if (inside.length && !input.evidence) notes.push(`${inside.length} agent screenshot(s) not read: the evidence bucket EVIDENCE is not configured.`);
  else for (const ref of inside) {
    const shot = await agentShot(input.evidence!, ref, notes);
    if (shot) shots.push(shot);
  }
  if (!refs.length) notes.push("The agent attached no screenshots.");

  if (!shots.length) return notRun(`No screenshots to judge. ${notes.join(" ")}`.trim(), { provenance: { provider: "none", model: s1.model } });

  const node = input.model.index.byId[c.subjectId];
  const subject = { id: c.subjectId, ...(node?.kind && { kind: node.kind }), ...(node?.name && { name: node.name }) };
  const page = { path: input.hook.inputs.path ?? "/", ...("url" in target && { url: target.url }) };
  const askMs = Math.max(10_000, Math.min(60_000, input.hook.timeoutMs));
  const groups = batches(shots);
  if (groups.length > MAX_ASKS) return notRun(`${shots.length} screenshots would need ${groups.length} asks; a visual check makes at most ${MAX_ASKS}.`, { provenance: { provider: "none", model: s1.model } });
  const results: { shots: Shot[]; r: VisualResult }[] = [];
  for (const group of groups) {
    const labels: VisualImageLabel[] = group.map((s) => ({ source: s.source, label: s.label, sha256: s.image.sha256 }));
    const r = await visualCriterion(s1, { criterion: { id: c.id, title: c.title, claim: c.claim }, subject, page, images: labels }, group.map((s) => s.image), { timeoutMs: askMs });
    results.push({ shots: group, r });
  }

  const failed = results.filter((x) => x.r.verdict === "fail");
  const captured = shots.some((s) => s.source === "platform");
  const allPass = results.every((x) => x.r.verdict === "pass");
  // Agent screenshots can fail a check or leave it unknown, never pass it on their own.
  const verdict = failed.length ? "fail" : allPass && captured ? "pass" : "unknown";
  if (allPass && !captured) notes.unshift(`Not a pass: ${UNVERIFIED}.`);
  const errors = results.filter((x) => x.r.provenance.error);
  const stored = shots.some((s) => s.key);
  const providers = [...new Set(results.map((x) => x.r.provenance.provider))].join(",");
  const concerns = failed.map((x) => x.r.concern?.choice).filter((k): k is string => !!k && k !== "none");
  const sources = [...new Set(shots.map((s) => s.source))];
  return {
    execution: "completed",
    verdict,
    observations: results.map(({ shots: group, r }) => ({
      images: group.map((s) => ({ source: s.source, label: s.label, mediaType: s.image.mediaType, bytes: s.bytes, sha256: s.image.sha256, ...(s.key && { key: s.key }) })),
      satisfies: r.satisfies,
      concern: r.concern,
      verdict: r.verdict,
      provenance: r.provenance,
    })),
    interpretation: verdict === "pass"
      ? `${shots.length} screenshot(s) judged to satisfy "${c.title}" at ≥ 0.9.`
      : verdict === "fail"
        ? `Screenshots judged not to satisfy "${c.title}"${concerns.length ? ` (${[...new Set(concerns)].join(", ")})` : ""}.`
        : `Screenshots did not settle "${c.title}": ${allPass && !captured ? UNVERIFIED : errors.length ? "System One failed for some batches" : "the judgment is under threshold"}.`,
    limitations: [
      `Judged from ${shots.length} screenshot(s) (${sources.join(" and ")}); a screenshot shows one state of the page at one size.`,
      ...notes,
      ...errors.map((x) => `System One: ${x.r.provenance.error!.message}`),
    ],
    provenance: {
      provider: providers,
      model: s1.model,
      images: String(shots.length),
      sources: sources.join(","),
      ...(stored && { evidenceKey: evidencePrefix(input.systemId, cand.realizationId, cand.commit) }),
      ...(shots.some((s) => s.source === "platform") && { capture: "browser-run:screenshot" }),
    },
  };
}
