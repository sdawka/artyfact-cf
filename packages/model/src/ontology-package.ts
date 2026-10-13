import { z } from "zod";
import { checkTemplateForm, hashOf, loadTemplate, TemplateSourceSchema, type TemplateStore } from "@artyfact/ontology";

const utf8Bytes = (text: string): number => { let n = 0; for (const c of text) { const p = c.codePointAt(0)!; n += p < 128 ? 1 : p < 2048 ? 2 : p < 65536 ? 3 : 4; } return n; };
const name = z.string().regex(/^[A-Za-z0-9][\w.-]{0,119}$/);
export const OntologyPackagePinSchema = z.strictObject({ id: name, version: name, hash: z.string().regex(/^[a-f0-9]{64}$/) });
export const NativeOntologyPackageSchema = z.strictObject({
  format: z.literal("artyfact.ontology-package@1"), id: name, version: name,
  dependencies: z.array(OntologyPackagePinSchema).max(64),
  templates: z.record(z.string().regex(/^template\.[\w.-]+@\d+$/), TemplateSourceSchema),
});
export type NativeOntologyPackage = z.input<typeof NativeOntologyPackageSchema>;
export type OntologyPackagePin = z.infer<typeof OntologyPackagePinSchema>;
export interface OntologyImportIssue { path: string; message: string }
export const ONTOLOGY_PACKAGE_MAX_BYTES = 256 * 1024;
export const ontologyPackageHash = (p: NativeOntologyPackage): string => hashOf(NativeOntologyPackageSchema.parse(p));
export const ontologyPackagePin = (p: NativeOntologyPackage): OntologyPackagePin => ({ id: p.id, version: p.version, hash: ontologyPackageHash(p) });

/** A resolver belongs to one System/load. It never caches a private source in the bundled global store. */
export function ontologyPackageStore(bundled: TemplateStore, packages: readonly NativeOntologyPackage[]): TemplateStore {
  const sources = new Map<string, unknown>();
  for (const p of packages) for (const [ref, raw] of Object.entries(p.templates)) {
    if (bundled.get(ref) !== undefined || (sources.has(ref) && hashOf(sources.get(ref)) !== hashOf(raw))) throw new Error(`template collision: ${ref}`);
    sources.set(ref, JSON.parse(JSON.stringify(raw)));
  }
  return { get: (ref) => sources.has(ref) ? JSON.parse(JSON.stringify(sources.get(ref))) : bundled.get(ref) };
}

/** Inspection is non-throwing for invalid sources; publication accepts only its validated result. */
export function inspectOntologyPackage(raw: unknown, opts: { bundled: TemplateStore; accepted: readonly NativeOntologyPackage[] }): {
  package?: NativeOntologyPackage; pin?: OntologyPackagePin; templateRefs: string[]; issues: OntologyImportIssue[];
} {
  const issues: OntologyImportIssue[] = [];
  let text: string;
  try { text = JSON.stringify(raw); } catch { return { templateRefs: [], issues: [{ path: "package", message: "expected JSON package" }] }; }
  if (!text || utf8Bytes(text) > ONTOLOGY_PACKAGE_MAX_BYTES) return { templateRefs: [], issues: [{ path: "package", message: "package exceeds 256 KiB limit" }] };
  const parsed = NativeOntologyPackageSchema.safeParse(raw);
  if (!parsed.success) return { templateRefs: [], issues: parsed.error.issues.map(i => ({ path: i.path.join("."), message: i.message })) };
  const p = parsed.data;
  const refs = Object.keys(p.templates);
  if (!refs.length || refs.length > 32) issues.push({ path: "templates", message: "expected 1 to 32 templates" });
  const hash = ontologyPackageHash(p);
  const same = opts.accepted.find(a => a.id === p.id && a.version === p.version);
  if (same && ontologyPackageHash(same) !== hash) issues.push({ path: "version", message: "immutable package version collision" });
  const deps: NativeOntologyPackage[] = [];
  const seen = new Set<string>();
  for (const pin of p.dependencies) {
    const key = `${pin.id}@${pin.version}`;
    if (seen.has(key) || (pin.id === p.id && pin.version === p.version)) issues.push({ path: "dependencies", message: `duplicate or self dependency ${key}` });
    seen.add(key);
    const found = opts.accepted.find(a => a.id === pin.id && a.version === pin.version && ontologyPackageHash(a) === pin.hash);
    if (!found) issues.push({ path: "dependencies", message: `unknown dependency or hash mismatch ${key}` });
    else deps.push(found);
  }
  // Dependencies bring their own pinned closure; unrelated private packages remain unavailable.
  const expanded = new Set(deps.map(d => `${d.id}@${d.version}`));
  for (let i = 0; i < deps.length && deps.length <= 128; i++) for (const pin of deps[i]!.dependencies) {
    const key = `${pin.id}@${pin.version}`;
    if (expanded.has(key)) continue;
    const found = opts.accepted.find(a => a.id === pin.id && a.version === pin.version && ontologyPackageHash(a) === pin.hash);
    if (!found) issues.push({ path: "dependencies", message: `unknown transitive dependency ${key}` });
    else { expanded.add(key); deps.push(found); }
  }
  if (deps.length > 128) issues.push({ path: "dependencies", message: "dependency closure exceeds limit" });
  for (const [ref, t] of Object.entries(p.templates)) {
    if (`${t.id}@${t.version}` !== ref) issues.push({ path: `templates.${ref}`, message: "template ref does not match id/version" });
    for (const accepted of opts.accepted) if (accepted.templates[ref] && hashOf(accepted.templates[ref]) !== hashOf(t)) issues.push({ path: `templates.${ref}`, message: "immutable template version collision" });
  }
  if (!issues.length) try {
    const store = ontologyPackageStore(opts.bundled, [...deps, p]);
    for (const ref of refs) {
      const template = loadTemplate(p.templates[ref], store);
      const form = checkTemplateForm(template, store);
      if (!form.valid && !form.findings.some(f => f.level === "error")) issues.push({ path: `templates.${ref}`, message: "template validation incomplete" });
      for (const f of form.findings.filter(f => f.level === "error")) issues.push({ path: `templates.${ref}`, message: `${f.rule}: ${f.subject}` });
    }
  } catch (e) { issues.push({ path: "templates", message: (e as Error).message }); }
  return { ...(!issues.length && { package: p, pin: { id: p.id, version: p.version, hash } }), templateRefs: refs, issues };
}
