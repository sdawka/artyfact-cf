import { env } from "cloudflare:workers";
import { afterAll, expect, it } from "vitest";
import { ensureFakePlatform, exampleSystemId, FAKE_ACTIVITY, resetFakePlatform } from "../worker/artifacts/fake-platform";
import { reviewLifecyclePlan } from "../worker/lifecycle-service";
import { reviewLifecycleTask } from "../worker/lifecycle-task-review";
import { systemStub } from "../worker/service";

// FAKE_MODEL_DELTA=1 (the fake e2e projects): the Review view's demo data for Task candidates that change the model.
const flags = env as { FAKE_ARTIFACTS?: string; FAKE_MODEL_DELTA?: string };
afterAll(() => { flags.FAKE_ARTIFACTS = ""; flags.FAKE_MODEL_DELTA = ""; resetFakePlatform(); });

it("seeds a submitted Task candidate with a model delta and an integrated plan with one", async () => {
  flags.FAKE_ARTIFACTS = "1"; flags.FAKE_MODEL_DELTA = "1";
  await ensureFakePlatform(env);
  const plans = await systemStub(env, exampleSystemId).realizationPlans();
  const plan = plans.find((p) => p.title === FAKE_ACTIVITY.modelPlanTitle)!, task = plan.tasks.find((t) => t.id === FAKE_ACTIVITY.modelTask)!;
  expect(task).toMatchObject({ status: "submitted", model: { prefix: "system", genomeCommit: plan.genome.commit } });
  const review = await reviewLifecycleTask(env, exampleSystemId, plan.id, task.id);
  expect(review.layers).toMatchObject({ "C.system.structure": "genome", "C.webapp.screen.people": "realization", "C.webapp.health": "phenome", "C.model.review": "genome" });
  const [entry] = review.candidates;
  expect(entry.model).toMatchObject({ prefix: "system", genomeCommit: plan.genome.commit, reason: FAKE_ACTIVITY.modelReason });
  expect(entry.model!.loadError).toBeUndefined();
  expect(entry.model!.changedPaths.filter((p) => p.endsWith("/node.yaml"))).toHaveLength(2);
  expect(entry.model!.delta.added).toEqual([FAKE_ACTIVITY.modelAddedNode]);
  expect(entry.model!.delta.changed.map((c) => c.id)).toEqual([FAKE_ACTIVITY.modelNode]);
  expect(entry.model!.outsideWriteNodes).toBeUndefined();
  expect(entry.model!.review!.review.length).toBeGreaterThan(0);
  expect(entry.model!.review!.review.every((r) => ["pass", "fail", "unknown"].includes(r.verdict))).toBe(true);
  expect(entry.evaluations.find((e) => e.criterion === "C.model.review")).toMatchObject({ execution: "completed" });

  const second = plans.find((p) => p.title === FAKE_ACTIVITY.integratedPlanTitle)!;
  expect(second.status).toBe("integrated");
  const pr = await reviewLifecyclePlan(env, exampleSystemId, second.id);
  expect(pr.modelDelta).toBeDefined();
  expect(pr.modelDelta!.model.delta.changed.map((c) => c.id)).toEqual([FAKE_ACTIVITY.integratedNode]);
  expect(pr.layers).toMatchObject({ "C.webapp.lifecycle.data": "realization", "C.model.review": "genome" });
});
