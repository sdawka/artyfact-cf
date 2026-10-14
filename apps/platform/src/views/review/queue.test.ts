import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { candidate, commit, realization } from "../work/testData";
import { awaitingReview, behindBy, IMPORT_GROUP, importLabel, reviewQueue, waitingCount } from "./queue";

import { makePlan, task, attempt } from "../work/plan/testPlan";

const evolutions = fixtureBundle().model.evolutions;
const E1 = evolutions[0]!.id;
const E2 = evolutions[1]!.id;
const c1 = commit({ id: "sc-1", parent: null });
const c2 = commit({ id: "sc-2", parent: "sc-1" });
const c3 = commit({ id: "sc-3", parent: "sc-2" });

describe("behindBy", () => {
  it("counts commits from base to head; 0 when equal; null when the base is not an ancestor; undefined without a base", () => {
    expect(behindBy("sc-3", "sc-3", [c1, c2, c3])).toBe(0);
    expect(behindBy("sc-1", "sc-3", [c1, c2, c3])).toBe(2);
    expect(behindBy("sc-x", "sc-3", [c1, c2, c3])).toBeNull();
    expect(behindBy(undefined, "sc-3", [c1, c2, c3])).toBeUndefined();
    expect(behindBy(null, null, [])).toBe(0);
    expect(behindBy("sc-1", null, undefined)).toBeUndefined();
  });
});

describe("reviewQueue", () => {
  it("is empty when nothing waits", () => {
    expect(reviewQueue({ evolutions, realizations: [realization({ status: "working" }), realization({ id: "r.p", status: "promoted" })] })).toEqual([]);
  });

  it("lists open candidates, amendments and a promotion row per Evolution, grouped in board order", () => {
    const groups = reviewQueue({
      evolutions,
      commits: [c1],
      realizations: [
        realization({ id: "r.2", evolution: E2, status: "submitted", candidate: "cand.2", baseRevision: "sc-1" }),
        realization({ id: "r.1", evolution: E1, status: "evaluated", candidate: "cand.1", baseRevision: "sc-1" }),
        realization({ id: "r.g", evolution: E1, status: "awaiting-admin", target: "genome", candidate: "cand.g" }),
      ],
    });
    expect(groups.map((g) => g.evolution)).toEqual([E1, E2]);
    expect(groups[0]!.title).toBe(evolutions[0]!.title);
    expect(groups[0]!.rows.map((r) => r.kind)).toEqual(["amendment", "candidate", "promotion"]);
    expect(groups[0]!.rows[1]).toMatchObject({ candidateId: "cand.1", behind: 0 });
    // A submitted (not yet evaluated) candidate is not promotable yet.
    expect(groups[1]!.rows.map((r) => r.kind)).toEqual(["candidate"]);
    expect(awaitingReview(groups[0])).toBe(2);
    // One decision per open realization: the promotion row is where E1's candidate is decided, not a fourth item.
    expect(waitingCount(groups)).toBe(3);
  });

  it("marks a candidate whose base is behind head as stale with the distance, and leaves it out of promotion", () => {
    const [g] = reviewQueue({
      evolutions,
      commits: [c1, c2, c3],
      realizations: [realization({ status: "evaluated", baseRevision: "sc-1" })],
      candidates: [candidate({ baseRevision: "sc-2" })],
    });
    // The loaded candidate's base wins over the realization's.
    expect(g!.rows).toHaveLength(1);
    expect(g!.rows[0]).toMatchObject({ kind: "stale", behind: 1, candidateId: "cand.1" });
  });

  it("waits for the history before calling a candidate stale: no flash, the promotion row stays", () => {
    const [g] = reviewQueue({ evolutions, commits: undefined, realizations: [realization({ status: "evaluated", candidate: "cand.1", baseRevision: "sc-1" })] });
    expect(g!.rows.map((r) => r.kind)).toEqual(["candidate", "promotion"]);
    expect(g!.rows[0]!.behind).toBeUndefined();
  });

  it("drops a realization whose loaded candidate is already promoted or rejected", () => {
    expect(reviewQueue({ evolutions, realizations: [realization({ status: "evaluated" })], candidates: [candidate({ state: "rejected" })] })).toEqual([]);
  });

  it("attaches each candidate's conflicts and merges them on the promotion row", () => {
    const soft = { kind: "soft-semantic" as const, candidates: ["cand.1", "cand.9"], subjects: [], nodes: ["screen.people"], message: "overlap" };
    const [g] = reviewQueue({ evolutions, realizations: [realization({ status: "evaluated", candidate: "cand.1" })], conflicts: [soft] });
    expect(g!.rows[0]!.conflicts).toEqual([soft]);
    expect(g!.rows.at(-1)).toMatchObject({ kind: "promotion", conflicts: [soft] });
  });

  it("puts a pending import review first, in its own group, with the node count; not counted as an Evolution's review", () => {
    const groups = reviewQueue({
      evolutions,
      realizations: [realization({ id: "r.g", evolution: E1, status: "awaiting-admin", target: "genome", candidate: "cand.g" })],
      importReview: { status: "pending", genomeCommit: "abc1234def", nodes: 12 },
    });
    expect(groups.map((g) => g.title)).toEqual(["Import", evolutions[0]!.title]);
    expect(groups[0]).toMatchObject({ evolution: IMPORT_GROUP, rows: [{ kind: "import", key: "import:abc1234def", importReview: { genomeCommit: "abc1234def", nodes: 12 } }] });
    expect(awaitingReview(groups[0])).toBe(0);
    // The rail and the queue heading count it once, beside the Evolution's own waiting rows.
    expect(waitingCount(groups)).toBe(1 + awaitingReview(groups[1]));
    expect(importLabel(12)).toBe("Import · 12 nodes");
    expect(importLabel(1)).toBe("Import · 1 node");
  });

  it("drops the import row once the review is accepted", () => {
    expect(reviewQueue({ evolutions, realizations: [], importReview: { status: "accepted", genomeCommit: "abc", nodes: 3 } })).toEqual([]);
    expect(reviewQueue({ evolutions, realizations: [], importReview: { status: "pending", genomeCommit: "abc", nodes: 3 } })[0]!.rows.map((r) => r.kind)).toEqual(["import"]);
  });
});
it('keeps independent Task attempts out of the legacy Evolution decision queue',()=>{
 expect(reviewQueue({evolutions,realizations:[realization({id:'realization.task',evolution:'',status:'evaluated',candidate:'candidate.task'})]})).toEqual([]);
});

it("keeps active and completed-unagreed integrity runs in the one Review inbox", () => {
 const run = (id:string,state:"queued"|"completed", agreement?: unknown) => ({id,systemId:"system.peopling",snapshotId:"snapshot",snapshotHash:"sha256:s",provider:"off",requestedCalls:1,attempt:1,state,createdAt:"",updatedAt:"",reviewUrl:"/start", ...(state === "completed" ? {report:{status:"needs-review"}} : {}), ...(agreement ? {agreement} : {})}) as any;
 const groups=reviewQueue({evolutions,realizations:[],integrityRuns:[run("run.queued","queued"),run("run.pending","completed"),run("run.done","completed",{status:"accepted"})]});
 expect(groups).toHaveLength(1);expect(groups[0]!.title).toBe("Integrity");expect(groups[0]!.rows.map(r=>r.integrity?.id)).toEqual(["run.queued","run.pending"]);
});

it("counts import, legacy, submitted Task and integrated plan once each", () => {
 const submitted=makePlan({tasks:[task("t1",{status:"submitted",attempts:[attempt({id:"a1"}),attempt({id:"a2"})]}),task("t2",{status:"selected"}),task("t3",{status:"completed"})]});
 const integrated=makePlan({id:"integrated",status:"integrated",tasks:[]});
 const groups=reviewQueue({evolutions,commits:[c1],realizations:[realization({status:"evaluated",baseRevision:"sc-1"}),realization({evolution:"",status:"evaluated"})],plans:[submitted,integrated,makePlan({id:"done",status:"promoted"})],importReview:{status:"pending",genomeCommit:"abc",nodes:2}});
 expect(waitingCount(groups)).toBe(4);
 expect(groups.flatMap(g=>g.rows).filter(r=>r.kind==="task-selection")).toHaveLength(1);
 expect(groups.flatMap(g=>g.rows).filter(r=>r.kind==="plan-promotion")).toHaveLength(1);
});
