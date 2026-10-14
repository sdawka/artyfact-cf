/**
 * System import review (backend.md B.10; contract: docs/design/lifecycle.md "Contract addendum"). An import that writes
 * a new System commit leaves the imported Genome pending as an agreement tree; work is refused 409 `import-unreviewed`
 * until an admin accepts it. Accepting with rejected nodes commits their removal at once through the intents accept,
 * which also approves. Storage is the DO's (`importReview`/`setImportReview`/`casImportReview`).
 */
import { loadGenome, validate, type Readiness, type SystemModel } from "@artyfact/model";
import { applyOps, parseTree, type NodeCriterion, type TemplateStore, type TreeOp } from "@artyfact/ontology";
import type { ProposalPlanNode, ProposedOp, SystemImportReview, SystemImportReviewAccept, SystemImportReviewAcceptResponse } from "../shared/api";
import { artifactsFor, withRepo } from "./artifacts/client";
import { listTree, type LoadedGenome } from "./artifacts/genome-source";
import { nodesForPath, sourceMapFor } from "./artifacts/source-map";
import type { HeadState } from "./do/system-authority";
import { badRequest, conflict, notFound, unprocessable } from "./errors";
import { acceptProposal } from "./intents";
import { readinessReport } from "./model-bundle";
import { acceptedTemplateResolver } from "./ontology-packages/store";
import { createEvolution, genomeAt, refreshRegistry, registryStub, reject, revokeEnded, systemStub, withPlatform } from "./service";
import { nowIso } from "./util";

async function headState(env: Env, systemId: string): Promise<HeadState> {
  const s = await systemStub(env, systemId).state();
  if (!s) throw notFound(`system ${systemId} is not imported`);
  return s;
}

/** The imported Genome as an agreement tree: roots are the System's children (its Things), every node added. */
function importTree(m: SystemModel): ProposalPlanNode[] {
  const node = (id: string): ProposalPlanNode => {
    const e = m.index.byId[id];
    const description = (e?.item as { description?: unknown } | undefined)?.description;
    return {
      id, kind: e?.kind ?? "node", title: e?.name ?? id, path: m.index.path(id),
      summary: typeof description === "string" ? description.trim() : "", opIds: [], children: (m.index.children[id] ?? []).map(node),
    };
  };
  return (m.index.children[m.system.id] ?? []).map(node);
}

/** Every node of an agreement tree with its ancestors (nearest last), in tree order. */
function treeNodes(tree: ProposalPlanNode[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (ns: ProposalPlanNode[], ancestors: string[]) => {
    for (const n of ns) {
      out.set(n.id, ancestors);
      walk(n.children ?? [], [...ancestors, n.id]);
    }
  };
  walk(tree, []);
  return out;
}

/**
 * The review of a loaded Genome: its tree, the readiness findings the model routes compute, and the app head's paths no
 * node's `files` maps (`.artyfact/**` excluded). Computed once per import and stored in the DO.
 */
export async function buildImportReview(env: Env, s: HeadState, g: LoadedGenome, review: Pick<SystemImportReview, "status" | "genomeCommit">): Promise<SystemImportReview> {
  const findings = withPlatform(s, readinessReport(g.model, g.readiness, [])).findings;
  const sm = sourceMapFor(g.model);
  const unmapped = s.appSource
    ? [...(await withRepo(artifactsFor(env), s.appSource.repo, (r) => listTree(r, s.appSource!.commit))).keys()]
      .filter((p) => !p.startsWith(".artyfact/") && nodesForPath(sm, p).every((n) => n.startsWith("unmapped:"))).sort()
    : [];
  return { ...review, tree: importTree(g.model), findings, ...capUnmapped(unmapped) };
}

/** At most this many unmapped paths are stored and served; `unmappedTotal` counts them all. */
export const UNMAPPED_CAP = 200;

/**
 * The stored review keeps the first {@link UNMAPPED_CAP} sorted paths (the DO row stays small for a large app repo) and
 * the total.
 */
function capUnmapped(all: string[]): { unmapped: string[]; unmappedTotal: number } {
  return { unmapped: all.slice(0, UNMAPPED_CAP), unmappedTotal: all.length };
}

/**
 * `importSystem`'s one call, after the DO bootstrap. `review: false` clears a pending review (an accepted one stays).
 * Otherwise an import that wrote a new System commit (first import, or a forced re-point) stores a new pending review;
 * a re-import that wrote no commit leaves the stored review alone. The caller registers the summary afterwards.
 */
export async function recordImportReview(env: Env, systemId: string, input: {
  review: unknown; head: string | null | undefined; priorHead: string | null | undefined; genome: LoadedGenome; genomeCommit: string;
}): Promise<void> {
  const stub = systemStub(env, systemId);
  if (input.review === false) {
    if ((await stub.importReview())?.status === "pending") await stub.setImportReview(null);
    return;
  }
  if (!input.head || input.head === input.priorHead) return;
  await stub.setImportReview(await buildImportReview(env, await headState(env, systemId), input.genome, { status: "pending", genomeCommit: input.genomeCommit }));
}

/**
 * 409 `import-unreviewed` while the System's import review is pending: the guard of every route that creates or starts
 * work. Routes call it before reading their body. No flag bypasses it.
 */
export async function assertImportReviewed(env: Env, systemId: string): Promise<void> {
  const review = await systemStub(env, systemId).importReview();
  if (review?.status !== "pending") return;
  throw conflict("import-unreviewed", `the import of ${systemId} is not reviewed yet; accept it at /s/${encodeURIComponent(systemId)}/r/head/review?panel=import first`,
    { genomeCommit: review.genomeCommit });
}

/** `GET /api/systems/:id/import-review`: 404 when the System was imported without a review. */
export async function importReview(env: Env, systemId: string): Promise<SystemImportReview> {
  await headState(env, systemId);
  const review = await systemStub(env, systemId).importReview();
  if (!review) throw notFound(`system ${systemId} has no import review`);
  return review;
}

/** Evolution records are history: they keep naming the nodes they affected after those are removed. */
const HISTORY_RELS = new Set(["affects", "acceptance"]);
/** Field id lists a removed id is dropped from (a Thing's sections, a journey's or step's references). */
const ID_LIST_FIELDS = ["sections", "purposeRefs", "features", "requirements", "requirementRefs"] as const;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * The ops that remove the `roots` subtrees from `files` without leaving a reference to anything removed (the nodes,
 * their criteria and inline hooks): an `unlink` per `links` entry of a surviving node (every kind, `refines` and step
 * links included), an `update` dropping removed ids from a surviving criterion's `refines`/`satisfies`/`sourceRefs`/
 * `hooks`, from a step's `next` and from the id lists in {@link ID_LIST_FIELDS}, then a `remove` per root. The ops are
 * applied and the result loaded (with the System's templates) and validated here; a reference no op can drop (a journey
 * starting at a removed step, a template requirement, a Genome that no longer loads, a hard readiness violation the base
 * did not have) is a 422 `rejected-node-referenced` naming the node that holds it and the rejected node. Findings on
 * Evolution records are exempt: they are history.
 */
export function rejectionOps(base: { files: Map<string, string>; readiness: Readiness }, roots: string[], templates: TemplateStore): RejectionPlan {
  const { files } = base;
  const tree = parseTree(files);
  const dirs = roots.map((r) => {
    const n = tree.nodes.get(r);
    if (!n) throw badRequest(`not a node of the imported Genome: ${r}`);
    return n.dir;
  });
  const inside = (dir: string, d: string) => dir === d || dir.startsWith(`${d}/`);
  const under = (n: { dir: string }) => dirs.some((d) => inside(n.dir, d));
  // Which rejected root a removed id goes with, for the 422 message.
  const rootOf = new Map<string, string>();
  for (const n of tree.nodes.values()) {
    if (!under(n)) continue;
    const root = roots.find((r) => inside(n.dir, tree.nodes.get(r)!.dir))!;
    rootOf.set(n.id, root);
    for (const c of n.file.criteria ?? []) {
      rootOf.set(c.id, root);
      for (const h of c.hooks ?? []) if (typeof h !== "string") rootOf.set(h.id, root);
    }
  }
  const removed = (id: unknown) => typeof id === "string" && rootOf.has(id);
  const blocked: string[] = [];
  const block = (holder: string, to: string, how: string) => blocked.push(`${holder} ${how} ${to} (under rejected ${rootOf.get(to)})`);

  const ops: ProposedOp[] = [];
  const op = (o: Omit<ProposedOp, "id">) => ops.push({ id: `op.${ops.length + 1}`, ...o } as ProposedOp);
  for (const n of tree.nodes.values()) {
    if (under(n)) continue;
    const f = n.file;
    for (const l of f.links ?? []) if (removed(l.to)) op({ op: "unlink", node: n.id, link: { rel: l.rel, to: l.to } });
    const fields: Record<string, unknown> = {};
    if (f.kind === "step" && n.parent !== undefined && Array.isArray(f.fields?.next)) {
      const next = f.fields.next as unknown[];
      const kept = next.filter((x) => !(isRecord(x) && removed(`${n.parent}/${String(x.to)}`)));
      if (kept.length !== next.length) fields.next = kept.length ? kept : null;
    }
    for (const key of ID_LIST_FIELDS) {
      const list = f.fields?.[key];
      if (!Array.isArray(list)) continue;
      const kept = list.filter((x) => !removed(x));
      if (kept.length !== list.length) fields[key] = kept;
    }
    if (f.kind === "journey" && typeof f.fields?.start === "string" && removed(`${n.id}/${f.fields.start}`)) block(n.id, `${n.id}/${f.fields.start}`, "starts at");
    const criteria: NodeCriterion[] = [];
    for (const c of f.criteria ?? []) {
      const fixed: Record<string, unknown> = { ...c };
      let changed = false;
      for (const key of ["refines", "satisfies", "sourceRefs", "hooks"] as const) {
        const list = c[key] as unknown[] | undefined;
        if (!list) continue;
        const kept = list.filter((x) => !removed(typeof x === "string" ? x : undefined));
        if (kept.length === list.length) continue;
        changed = true;
        if (kept.length) fixed[key] = kept;
        else delete fixed[key];
      }
      if (changed) criteria.push(fixed as NodeCriterion);
    }
    if (Object.keys(fields).length || criteria.length) {
      op({ op: "update", node: n.id, ...(Object.keys(fields).length && { fields }), ...(criteria.length && { criteria }) });
    }
  }
  for (const node of roots) op({ op: "remove", node });

  // The amended Genome must load and hold no structural link to a removed id (template `requires`, derived links).
  let model: SystemModel;
  try {
    const { changes } = applyOps(files, ops as TreeOp[]);
    const after = new Map(files);
    for (const c of changes) {
      if (c.content === null) after.delete(c.path);
      else after.set(c.path, c.content);
    }
    model = loadGenome(after, { templates });
  } catch (e) {
    throw unprocessable("rejected-node-referenced", `removing ${roots.join(", ")} breaks the Genome: ${(e as Error)?.message ?? e}`);
  }
  for (const l of model.graph.links) {
    if (!rootOf.has(l.from) && removed(l.to) && !HISTORY_RELS.has(l.rel)) block(l.from, l.to, `still references (${l.rel})`);
  }
  // A hard violation the amendment introduces (a template-required section now missing) blocks it too.
  // Evolution records are history (HISTORY_RELS): one naming a removed node is not a structural violation.
  const history = new Set(tree.evolutions.map((e) => e.evolution.id));
  const hard = (r: Readiness) => new Set(r.findings.filter((x) => x.level === "error" && !history.has(x.subject ?? "")).map((x) => `${x.rule} ${x.subject ?? ""}`));
  const before = hard(base.readiness);
  for (const v of hard(validate(model))) if (!before.has(v)) blocked.push(`${v.replace(" ", " on ").trim()} after removing ${roots.join(", ")}`);
  if (blocked.length) {
    throw unprocessable("rejected-node-referenced", `cannot reject without a dangling reference: ${[...new Set(blocked)].join("; ")}`);
  }
  return { ops, removed: rootOf };
}

/** {@link rejectionOps}' result: the ops, and every removed id (nodes, criteria, inline hooks) with its rejected root. */
export interface RejectionPlan { ops: ProposedOp[]; removed: Map<string, string> }

/** Evolution states that never run a gate again. */
const SETTLED_EVOLUTION = new Set(["promoted", "rejected", "withdrawn"]);

/**
 * Live Evolutions whose acceptance criteria the removal deletes. They stay as they are (history) and their gate fails
 * closed ("criterion not found") until they are withdrawn or the criteria come back; the accept says so by name.
 */
export function liveEvolutionWarnings(evolutions: { id: string; state: string; acceptanceCriteria?: string[] }[], removed: Map<string, string>): string[] {
  return evolutions.filter((e) => !SETTLED_EVOLUTION.has(e.state)).flatMap((e) => {
    const gone = (e.acceptanceCriteria ?? []).filter((c) => removed.has(c));
    if (!gone.length) return [];
    const roots = [...new Set(gone.map((c) => removed.get(c)!))];
    return [`${e.id} (${e.state}) accepts ${gone.join(", ")}, which removing ${roots.join(", ")} deletes; its gate fails closed until it is withdrawn or those criteria are added back`];
  });
}


/** Test seam: the intents accept the removal goes through (tests wrap it to fail after the approve). */
let acceptAmendment: typeof acceptProposal = acceptProposal;
export function setAmendmentAccept(fn: typeof acceptProposal | undefined): void { acceptAmendment = fn ?? acceptProposal; }

/**
 * `POST /api/systems/:id/import-review/accept` (admin). Validation and the removal ops ({@link rejectionOps}) come first
 * and are read-only. Then the review flips pending → accepted by a DO compare-and-set on status and `genomeCommit` (a
 * concurrent second accept, or one racing a re-import, is 409 `invalid-state`). Rejected nodes (a node under another
 * rejected node is covered by the ancestor's removal) are then removed by a platform-authored proposal with its own
 * linked Evolution, accepted through the intents accept, which pushes and approves: the removal is committed when this
 * returns. Any failure after the flip rejects a candidate left staged, compare-and-sets the review back to pending and
 * rethrows.
 */
export async function acceptImportReview(env: Env, systemId: string, body: Partial<SystemImportReviewAccept>, platformUrl: string): Promise<SystemImportReviewAcceptResponse> {
  const { interpretation, rejectedNodes } = body;
  if (interpretation !== undefined && (typeof interpretation !== "string" || interpretation.length > 4000)) throw badRequest("interpretation must be a string of at most 4000 characters");
  if (rejectedNodes !== undefined && (!Array.isArray(rejectedNodes) || rejectedNodes.some((n) => typeof n !== "string"))) throw badRequest("rejectedNodes must be an array of node ids");
  const s = await headState(env, systemId);
  const stub = systemStub(env, systemId);
  const review = await stub.importReview();
  if (!review) throw notFound(`system ${systemId} has no import review`);
  if (review.status !== "pending") throw conflict("invalid-state", `the import review of ${systemId} is already accepted`);
  const reviewable = treeNodes(review.tree);
  const rejected = [...new Set(rejectedNodes ?? [])];
  const unknown = rejected.filter((n) => !reviewable.has(n));
  if (unknown.length) throw badRequest(`not nodes of the imported Genome: ${unknown.join(", ")}`);
  const roots = rejected.filter((n) => !reviewable.get(n)!.some((a) => rejected.includes(a)));
  if (roots.length && s.genomeCommit !== review.genomeCommit) {
    throw conflict("stale-base", "the Genome moved since the import; rejected nodes cannot be removed from the reviewed commit");
  }
  // Built and validated before the review flips: a rejection that would leave a dangling reference is a 422 and the
  // review stays pending.
  const plan = roots.length
    ? rejectionOps(await genomeAt(env, systemId, review.genomeCommit, s.genomeSource), roots, acceptedTemplateResolver(await stub.ontologyAcceptedPackages()).templates)
    : { ops: [], removed: new Map<string, string>() };
  const { ops } = plan;
  const warnings = plan.removed.size ? liveEvolutionWarnings((await stub.work()).evolutions, plan.removed) : [];
  const accepted: SystemImportReview = {
    ...review, status: "accepted", decidedAt: nowIso(),
    ...(interpretation?.trim() && { interpretation: interpretation.trim() }), ...(rejected.length && { rejectedNodes: rejected }),
  };
  if (!(await stub.casImportReview("pending", review.genomeCommit, accepted))) {
    throw conflict("invalid-state", `the import review of ${systemId} was accepted or re-opened meanwhile`);
  }
  let amendment: SystemImportReviewAcceptResponse["amendment"];
  let proposalId: string | undefined, evolutionId: string | undefined;
  try {
    if (ops.length) {
      const message = `Import review: remove ${roots.length} node${roots.length === 1 ? "" : "s"}`;
      const intent = `${message} (${roots.join(", ")}), rejected when the import of ${review.genomeCommit.slice(0, 12)} was reviewed.`.slice(0, 4000);
      // Linked like an intent's proposal; the accept sets its affected nodes to the nodes the ops touch.
      const { evolution } = await createEvolution(env, systemId, { title: message, intent, kind: "genome-amendment" });
      evolutionId = evolution.id;
      const proposal = await stub.createProposal({
        evolutionId: evolution.id, systemId, message, status: "open", route: [], ops, questions: [], problems: [],
        provenance: { router: { provider: "platform", model: "import-review", calls: 0 }, translator: { provider: "platform", model: "import-review" }, genomeCommit: review.genomeCommit, fake: false },
        createdAt: nowIso(),
      });
      proposalId = proposal.id;
      const out = await acceptAmendment(env, systemId, proposal.id, { opIds: ops.map((o) => o.id) }, platformUrl);
      amendment = { evolution: out.evolution.id, realization: out.realization.id, candidate: out.candidate.id, ...(out.systemCommit && { systemCommit: out.systemCommit.id }) };
    }
  } catch (e) {
    const staged = proposalId ? (await stub.proposal(proposalId).catch(() => null))?.proposal.stagedApproval : undefined;
    // The approve already committed the removal (the staged realization is promoted) and something after it failed: the
    // review stays accepted, since the head holds what the admin decided. Answer with the amendment as committed.
    const committed = staged ? await stub.realization(staged.realizationId).catch(() => null) : null;
    if (staged && committed?.realization.status === "promoted") {
      console.error(`[import-review] ${systemId}: the removal committed but the accept failed after it: ${(e as Error)?.message ?? e}`);
      await refreshRegistry(env, systemId).catch(() => {});
      const head = (await stub.state())?.head ?? undefined;
      return {
        review: accepted, amendment: { evolution: staged.evolutionId, realization: staged.realizationId, candidate: staged.candidateId, ...(head && { systemCommit: head }) },
        ...(warnings.length && { warnings }),
      };
    }
    // A candidate pushed but not approved (the gate refused it) stays staged on the open proposal; reject it so a later
    // accept of that proposal cannot land the removal while the review is pending again.
    if (staged) {
      await reject(env, systemId, staged.realizationId, { reason: "the import review accept that pushed this removal failed" })
        .catch((r: unknown) => console.error(`[import-review] rejecting ${staged.realizationId} failed: ${(r as Error)?.message ?? r}`));
    }
    // The removal's proposal is the platform's own: abandon it so no open proposal is left to accept later.
    if (proposalId) {
      await stub.abandonProposal(proposalId)
        .catch((r: unknown) => console.error(`[import-review] abandoning ${proposalId} failed: ${(r as Error)?.message ?? r}`));
    }
    // Nothing committed, so the removal's Evolution goes too, with its realizations (tokens revoked, unregistered),
    // as a failed deferral discards its own.
    if (evolutionId) {
      try {
        const ended = await stub.discardEvolution(evolutionId);
        await revokeEnded(env, systemId, ended);
        await Promise.all(ended.map((x) => registryStub(env).unregisterRealization(systemId, x.realizationId)));
      } catch (w) {
        console.error(`[import-review] discarding ${evolutionId} after a failed accept failed: ${(w as Error)?.message ?? w}`);
      }
    }
    await stub.casImportReview("accepted", review.genomeCommit, review)
      .catch((r: unknown) => console.error(`[import-review] restoring pending for ${systemId} failed: ${(r as Error)?.message ?? r}`));
    await refreshRegistry(env, systemId).catch(() => {});
    throw e;
  }
  // Best-effort, like every registry refresh after a write: the accept has landed.
  await refreshRegistry(env, systemId).catch((r: unknown) => console.error(`[import-review] refreshing the registry for ${systemId} failed: ${(r as Error)?.message ?? r}`));
  return { review: accepted, ...(amendment && { amendment }), ...(warnings.length && { warnings }) };
}
