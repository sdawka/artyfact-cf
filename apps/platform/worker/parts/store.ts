import { partDigest, schema } from "@artyfact/model";
import type { PartRecord, PartScope, PartSummary } from "../../shared/api";
import { canonicalJson, nowIso } from "../util";

const PARTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS catalog_parts (
    scope_kind TEXT NOT NULL CHECK(scope_kind IN ('shared', 'system')),
    system_id TEXT NOT NULL DEFAULT '',
    part_id TEXT NOT NULL,
    version TEXT NOT NULL,
    package_json TEXT NOT NULL,
    digest TEXT NOT NULL,
    published_at TEXT NOT NULL,
    PRIMARY KEY (scope_kind, system_id, part_id, version)
  )`,
  "CREATE INDEX IF NOT EXISTS catalog_parts_scope ON catalog_parts(scope_kind, system_id, part_id, version)",
];

const MAX_PACKAGE_BYTES = 256 * 1024;
const MAX_DEPENDENCIES = 128;
const enc = new TextEncoder();
type Row = Record<string, SqlStorageValue>;
const stateError = (code: "not-found" | "invalid-state", message: string): Error => new Error(`[${code}] ${message}`);

function scopeKey(scope: PartScope): [kind: "shared" | "system", systemId: string] {
  return scope.kind === "shared" ? ["shared", ""] : ["system", scope.systemId];
}

function scopeFrom(row: Row): PartScope {
  return String(row.scope_kind) === "shared" ? { kind: "shared" } : { kind: "system", systemId: String(row.system_id) };
}

function dependencies(pkg: schema.PartPackage): schema.PartRef[] {
  const refs = pkg.recipe?.contributions.map((contribution) => contribution.part) ?? [];
  if (refs.length > MAX_DEPENDENCIES) throw stateError("invalid-state", `part package has more than ${MAX_DEPENDENCIES} dependencies`);
  return refs;
}

/** Immutable registry entries, held in the named registry Durable Object. */
export class PartsStore {
  constructor(private readonly sql: SqlStorage) {
    for (const statement of PARTS_SCHEMA) sql.exec(statement);
  }

  private rows(query: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec(query, ...args).toArray() as Row[];
  }

  private one(query: string, ...args: SqlStorageValue[]): Row | undefined {
    return this.rows(query, ...args)[0];
  }

  private record(row: Row): PartRecord {
    return {
      package: JSON.parse(String(row.package_json)) as schema.PartPackage,
      scope: scopeFrom(row),
      digest: String(row.digest),
      publishedAt: String(row.published_at),
    };
  }

  listParts(scope: PartScope): PartSummary[] {
    const [kind, systemId] = scopeKey(scope);
    return this.rows(
      "SELECT scope_kind, system_id, part_id, version, package_json, digest, published_at FROM catalog_parts WHERE scope_kind = ? AND system_id = ? ORDER BY part_id, version",
      kind, systemId,
    ).map((row) => {
      const record = this.record(row);
      return {
        partId: String(row.part_id), version: String(row.version), name: record.package.name,
        ...(record.package.description && { description: record.package.description }),
        scope: record.scope, digest: record.digest, publishedAt: record.publishedAt,
        dependencies: dependencies(record.package),
      };
    });
  }

  getPart(scope: PartScope, partId: string, version: string): PartRecord | null {
    const [kind, systemId] = scopeKey(scope);
    const row = this.one(
      "SELECT scope_kind, system_id, package_json, digest, published_at FROM catalog_parts WHERE scope_kind = ? AND system_id = ? AND part_id = ? AND version = ?",
      kind, systemId, partId, version,
    );
    return row ? this.record(row) : null;
  }

  private requireDependency(scope: PartScope, ref: schema.PartRef): void {
    const [kind, systemId] = scopeKey(scope);
    const local = kind === "system" ? this.one(
      "SELECT scope_kind, system_id FROM catalog_parts WHERE scope_kind = 'system' AND system_id = ? AND part_id = ? AND version = ?",
      systemId, ref.id, ref.version,
    ) : undefined;
    const shared = this.one(
      "SELECT scope_kind, system_id FROM catalog_parts WHERE scope_kind = 'shared' AND system_id = '' AND part_id = ? AND version = ?",
      ref.id, ref.version,
    );
    if (local && shared) throw stateError("invalid-state", `dependency ${ref.id}@${ref.version} is ambiguous between shared and System-private scopes`);
    if (local || shared) return;
    throw stateError("not-found", `exact dependency ${ref.id}@${ref.version} is not available in this scope`);
  }

  /**
   * Canonically hashes package content without its self-referential digest, then atomically validates and inserts it.
   * A private package can only see its own System's private packages plus shared packages.
   */
  async publishPart(scope: PartScope, candidate: schema.PartPackage): Promise<PartRecord> {
    if (!scope || (scope.kind !== "shared" && scope.kind !== "system") || (scope.kind === "system" && !scope.systemId)) {
      throw stateError("invalid-state", "a concrete shared or System-private scope is required");
    }
    const parsed = schema.PartPackage.safeParse(candidate);
    if (!parsed.success) throw stateError("invalid-state", "package does not match the PartPackage schema");
    candidate = parsed.data;
    if (scope.kind === "shared" && candidate.visibility !== "shared") {
      throw stateError("invalid-state", "shared catalog entries must have shared visibility");
    }
    if (scope.kind === "system" && (candidate.visibility !== "system-private" || candidate.systemId !== scope.systemId)) {
      throw stateError("invalid-state", "System-private package visibility and systemId must match the route scope");
    }
    const digest = partDigest(candidate);
    const suppliedDigest = candidate.digest;
    if (suppliedDigest && suppliedDigest !== digest) throw stateError("invalid-state", "package digest does not match canonical package content");
    const packageWithDigest = { ...candidate, published: true, digest } as schema.PartPackage;
    const serialized = canonicalJson(packageWithDigest);
    if (enc.encode(serialized).byteLength > MAX_PACKAGE_BYTES) {
      throw stateError("invalid-state", `part package exceeds ${MAX_PACKAGE_BYTES} byte limit`);
    }
    const refs = dependencies(packageWithDigest);
    const [kind, systemId] = scopeKey(scope);

    // No await follows the digest: a DO invocation cannot interleave this check and insert.
    const existing = this.one(
        "SELECT scope_kind, system_id, package_json, digest, published_at FROM catalog_parts WHERE scope_kind = ? AND system_id = ? AND part_id = ? AND version = ?",
        kind, systemId, packageWithDigest.id, packageWithDigest.version,
    );
    if (existing) {
      if (String(existing.digest) === digest) return this.record(existing);
      throw stateError("invalid-state", `part ${packageWithDigest.id}@${packageWithDigest.version} is immutable`);
    }
    // PartRef carries no scope. Forbid a shared/private coordinate collision so an already-published
    // private package can never have its dependency resolution changed by a later publication.
    const shadow = scope.kind === "shared"
      ? this.one("SELECT 1 AS x FROM catalog_parts WHERE scope_kind = 'system' AND part_id = ? AND version = ? LIMIT 1", packageWithDigest.id, packageWithDigest.version)
      : this.one("SELECT 1 AS x FROM catalog_parts WHERE scope_kind = 'shared' AND part_id = ? AND version = ?", packageWithDigest.id, packageWithDigest.version);
    if (shadow) throw stateError("invalid-state", `part ${packageWithDigest.id}@${packageWithDigest.version} already exists in an incompatible scope`);
    for (const ref of refs) this.requireDependency(scope, ref);
    const publishedAt = nowIso();
    this.sql.exec(
        "INSERT INTO catalog_parts (scope_kind, system_id, part_id, version, package_json, digest, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        kind, systemId, packageWithDigest.id, packageWithDigest.version, serialized, digest, publishedAt,
    );
    return { package: packageWithDigest, scope, digest, publishedAt };
  }
}
