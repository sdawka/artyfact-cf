import { systemRepoNames } from "@artyfact/cli/naming";
import { hashOf, type TemplateStore } from "@artyfact/ontology";
import { metaTemplates } from "@artyfact/templates";
import { inspectOntologyPackage, ontologyPackagePin, ontologyPackageStore, type NativeOntologyPackage } from "@artyfact/model";
import { stringify } from "yaml";
import { loadGenome } from "@artyfact/model";
import type { OntologyImportReview, OntologyImportPreviewRequest, OntologyImportsResponse, CreateInitialSystemResponse } from "../../shared/ontology-packages";

type Row = Record<string, SqlStorageValue>;
const refuse = (message: string): never => { throw new Error(`[invalid-state] ${message}`); };
/** Shared validation keeps every import entry point out of reserved/invalid DO names. */
export function isOntologySystemId(id: unknown): id is string {
  if (typeof id !== "string" || id === "__registry") return false;
  try { systemRepoNames(id); return true; } catch { return false; }
}
/** Every instance resides in its System's DO; no global private package catalog or resolver cache. */
export class OntologyPackagesStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS ontology_initial (singleton INTEGER PRIMARY KEY CHECK(singleton=1), system_id TEXT NOT NULL, title TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS ontology_imports (id TEXT PRIMARY KEY, review_json TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS ontology_packages (id TEXT NOT NULL, version TEXT NOT NULL, hash TEXT NOT NULL, package_json TEXT NOT NULL, PRIMARY KEY(id,version))");
  }
  initialize(systemId: string, title = systemId): CreateInitialSystemResponse {
    if (!isOntologySystemId(systemId)) refuse("invalid or reserved System id");
    const row = this.sql.exec("SELECT system_id FROM ontology_initial WHERE singleton=1").toArray()[0] as Row | undefined;
    if (row && row.system_id !== systemId) refuse("System scope mismatch");
    if (!row) this.sql.exec("INSERT INTO ontology_initial VALUES (1,?,?)", systemId, title.slice(0, 240));
    return { systemId, status: "import-pending", reviewUrl: `/start?system=${encodeURIComponent(systemId)}` };
  }
  initial(): { systemId: string; title: string } | null {
    const row = this.sql.exec("SELECT system_id,title FROM ontology_initial WHERE singleton=1").toArray()[0] as Row | undefined;
    return row ? { systemId: String(row.system_id), title: String(row.title) } : null;
  }
  acceptedPackages(): NativeOntologyPackage[] {
    return (this.sql.exec("SELECT package_json FROM ontology_packages ORDER BY id,version").toArray() as Row[]).map(r => JSON.parse(String(r.package_json)) as NativeOntologyPackage);
  }
  list(): OntologyImportsResponse {
    return { imports: (this.sql.exec("SELECT review_json FROM ontology_imports ORDER BY id DESC LIMIT 100").toArray() as Row[]).map(r => JSON.parse(String(r.review_json)) as OntologyImportReview),
      packages: this.acceptedPackages().map(ontologyPackagePin) };
  }
  get(id: string): OntologyImportReview | null {
    const row = this.sql.exec("SELECT review_json FROM ontology_imports WHERE id=?", id).toArray()[0] as Row | undefined;
    return row ? JSON.parse(String(row.review_json)) as OntologyImportReview : null;
  }
  preview(systemId: string, input: OntologyImportPreviewRequest): OntologyImportReview {
    this.initialize(systemId);
    const accepted = this.acceptedPackages();
    const result = inspectOntologyPackage(input.package, { bundled: metaTemplates, accepted });
    const issues = [...result.issues];
    let genomeFiles = input.genomeFiles;
    if (result.package && genomeFiles === undefined) {
      const rootRef = result.templateRefs.find(r => /^template\.(system|meta)\./.test(r));
      if (rootRef) genomeFiles = { "node.yaml": stringify({ id: systemId, kind: "system", template: rootRef, fields: { name: this.initial()?.title ?? systemId } }) };
    }
    if (result.package && genomeFiles !== undefined) {
      if (!genomeFiles || typeof genomeFiles !== "object" || Array.isArray(genomeFiles) || Object.values(genomeFiles).some(v => typeof v !== "string")) issues.push({ path: "genomeFiles", message: "expected path to text object" });
      else try {
        if (new TextEncoder().encode(JSON.stringify(genomeFiles)).length > 1_000_000) throw new Error("Genome exceeds size limit");
        const templates = ontologyPackageStore(metaTemplates, [...accepted.filter(p => p.id !== result.package!.id || p.version !== result.package!.version), result.package]);
        const model = loadGenome(genomeFiles, { templates });
        if (model.system.id !== systemId) issues.push({ path: "genomeFiles.node.yaml", message: "Genome System scope mismatch" });
      } catch (e) { issues.push({ path: "genomeFiles", message: (e as Error).message }); }
    }
    const review: OntologyImportReview = { id: `import.${crypto.randomUUID()}`, systemId, createdAt: new Date().toISOString(), status: issues.length ? "invalid" : "review",
      package: input.package, templateRefs: result.templateRefs, issues, ...(result.pin && { pin: result.pin }), ...(genomeFiles && { genomeFiles }) };
    // Invalid sources are inspectable, but bounded before storage (DO rows have finite limits).
    if (new TextEncoder().encode(JSON.stringify(review)).length > 1_500_000) refuse("import review exceeds storage limit");
    this.sql.exec("INSERT INTO ontology_imports VALUES (?,?)", review.id, JSON.stringify(review));
    return review;
  }
  accept(id: string, hash: string): OntologyImportReview {
    const review = this.get(id);
    if (!review) throw new Error("[not-found] import review not found");
    if (!review.pin || review.pin.hash !== hash) refuse("reviewed hash does not match");
    if (review.status === "accepted") return review;
    if (review.status !== "review") refuse("invalid import cannot be accepted");
    // Recheck immutable dependencies/collisions at acceptance, in the same synchronous DO turn as publication.
    const checked = inspectOntologyPackage(review.package, { bundled: metaTemplates, accepted: this.acceptedPackages() });
    if (!checked.package || !checked.pin || checked.pin.hash !== hash) refuse(checked.issues.map(i => i.message).join("; ") || "package changed");
    this.sql.exec("INSERT OR IGNORE INTO ontology_packages VALUES (?,?,?,?)", checked.pin!.id, checked.pin!.version, hash, JSON.stringify(checked.package));
    const stored = { ...review, ...(review.genomeFiles && { bootstrap: { directory: review.systemId.replace(/^system\./, ""), args: ["init", "--dir", review.systemId.replace(/^system\./, "")] } }), status: "accepted" as const, acceptedAt: new Date().toISOString() };
    this.sql.exec("UPDATE ontology_imports SET review_json=? WHERE id=?", JSON.stringify(stored), id);
    return stored;
  }
}
/** The hash is suitable as part of immutable Genome cache keys. */
export function acceptedTemplateResolver(packages: readonly NativeOntologyPackage[]): { templates: TemplateStore; digest: string } {
  return { templates: ontologyPackageStore(metaTemplates, packages), digest: hashOf(packages.map(ontologyPackagePin)) };
}
