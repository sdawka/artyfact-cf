import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";
import { ensureFakePlatform, resetFakePlatform } from "../worker/artifacts/fake-platform";

// The Worker entry serves /api/fake-git/ only under FAKE_ARTIFACTS=1; a deployed Worker must never expose it.
const flag = env as { FAKE_ARTIFACTS?: string };
const get = (path: string, init?: RequestInit) => exports.default.fetch(new Request(`http://example.com${path}`, init));
const refs = "/api/fake-git/peopling.app.git/info/refs?service=git-upload-pack";
afterEach(() => { flag.FAKE_ARTIFACTS = ""; resetFakePlatform(); });

it("does not serve fake git when FAKE_ARTIFACTS is unset", async () => {
  flag.FAKE_ARTIFACTS = "";
  expect((await get(refs)).status).toBe(404);
  expect((await get("/api/fake-git/peopling.app.git/git-receive-pack", { method: "POST" })).status).toBe(404);
});

it("serves fake git under FAKE_ARTIFACTS=1: no token is refused, a read token lists the seeded refs", async () => {
  flag.FAKE_ARTIFACTS = "1";
  const ns = await ensureFakePlatform(env);
  const repo = ns.repo("peopling.app");
  expect((await get("/api/fake-git/peopling.app.git/git-receive-pack", { method: "POST" })).status).toBe(401);
  expect((await get(refs)).status).toBe(401);
  const token = (await repo.createToken("read")).plaintext;
  const res = await get(refs, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("git-upload-pack");
  expect(await res.text()).toContain(repo.head!);
});
