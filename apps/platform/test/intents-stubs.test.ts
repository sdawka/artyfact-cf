import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { routes, type ApiError, type IntentAccept, type IntentReply, type IntentRequest, type NotImplementedResponse } from "../shared/api";
import { REGISTRY, type SystemAuthority } from "../worker/do/system-authority";

// Iteration-3 intent routes (W0): declared, admin only, 501 not-implemented until W7.

const S = "system.intents";
const P = "proposal 1";
const ADMIN = { authorization: "Bearer test-admin-token" };

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await exports.default.fetch(new Request(`http://example.com${path}`, {
    method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }),
  }));
  return { status: res.status, json: (await res.json()) as T };
}

const request: IntentRequest = { message: "Let users snooze a contact for a month", anchor: "screen.today" };
const reply: IntentReply = { answer: "A month", questionId: "q.1" };
const accept: IntentAccept = { opIds: ["op.1"] };
const cases: [string, string, unknown][] = [
  ["POST", routes.intents(S), request],
  ["GET", routes.intent(S, P), undefined],
  ["POST", routes.intentReply(S, P), reply],
  ["POST", routes.intentAccept(S, P), accept],
];

beforeAll(async () => {
  await runInDurableObject(env.SYSTEMS.getByName(REGISTRY), async (i: SystemAuthority) => {
    i.registerSystem({ systemId: S, title: "intents", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "0".repeat(40), evolutionCounts: {}, updatedAt: "" });
  });
});

describe("intent routes", () => {
  it("build their paths", () => {
    expect(routes.intents(S)).toBe(`/api/systems/${S}/intents`);
    expect(routes.intent(S, P)).toBe(`/api/systems/${S}/intents/proposal%201`);
    expect(routes.intentReply(S, P)).toBe(`/api/systems/${S}/intents/proposal%201/reply`);
    expect(routes.intentAccept(S, P)).toBe(`/api/systems/${S}/intents/proposal%201/accept`);
  });

  it.each(cases)("%s %s is 501 not-implemented for the admin", async (method, path, body) => {
    const r = await call<NotImplementedResponse>(method, path, body, ADMIN);
    expect(r.status).toBe(501);
    expect(r.json.error.code).toBe("not-implemented");
  });

  it.each(cases)("%s %s is admin only", async (method, path, body) => {
    expect((await call<ApiError>(method, path, body)).status).toBe(401);
    expect((await call<ApiError>(method, path, body, { authorization: "Bearer nope" })).status).toBe(403);
  });
});
