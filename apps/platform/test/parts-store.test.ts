import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { schema } from "@artyfact/model";
import { PartsStore } from "../worker/parts/store";
import { REGISTRY, type SystemAuthority } from "../worker/do/system-authority";

const shared = { kind: "shared" } as const;
const system = (systemId: string) => ({ kind: "system", systemId }) as const;

function pkg(id: string, version: string, extra: Record<string, unknown> = {}) {
  return schema.PartPackage.parse({
    id,
    version,
    name: id,
    visibility: "shared",
    payload: { files: { [`src/${id.replaceAll(".", "-")}.ts`]: "export {}\n" } },
    ...extra,
  });
}

async function inStore<T>(fn: (s: PartsStore) => Promise<T> | T): Promise<T> {
  return runInDurableObject(env.SYSTEMS.getByName(REGISTRY), (_i: SystemAuthority, state) => fn(new PartsStore(state.storage.sql)));
}

describe("PartsStore", () => {
  it("publishes an exact version once and rejects a changed replacement", async () => {
    await inStore(async (s) => {
      const first = await s.publishPart(shared, pkg("part.shared", "1.0.0"));
      expect(first.scope).toEqual(shared);
      expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/);

      await expect(s.publishPart(shared, pkg("part.shared", "1.0.0", { name: "changed" }))).rejects.toThrow(/immutable/i);
      expect(s.getPart(shared, "part.shared", "1.0.0")?.package.name).toBe("part.shared");
    });
  });

  it("allows a private package to pin shared dependencies but never exposes it from the shared catalog", async () => {
    await inStore(async (s) => {
      await s.publishPart(shared, pkg("part.base", "1.0.0"));
      await s.publishPart(system("system.one"), pkg("part.private", "1.0.0", {
        visibility: "system-private", systemId: "system.one",
      recipe: { id: "recipe.private", contributions: [{ id: "base", part: { id: "part.base", version: "1.0.0" } }] },
      }));

      expect(s.listParts(shared).map((p) => p.partId)).toEqual(expect.not.arrayContaining(["part.private"]));
      expect(s.getPart(system("system.one"), "part.private", "1.0.0")?.package.id).toBe("part.private");
    });
  });

  it("rejects missing dependencies and shared packages that transitively depend on a System-private package", async () => {
    await inStore(async (s) => {
      await expect(s.publishPart(shared, pkg("part.missing", "1.0.0", {
      recipe: { id: "recipe.missing", contributions: [{ id: "nope", part: { id: "part.none", version: "1.0.0" } }] },
      }))).rejects.toThrow(/dependency/i);

      await s.publishPart(system("system.one"), pkg("part.private-base", "1.0.0", { visibility: "system-private", systemId: "system.one" }));
      await expect(s.publishPart(shared, pkg("part.public-wrapper", "1.0.0", {
      recipe: { id: "recipe.public", contributions: [{ id: "private", part: { id: "part.private-base", version: "1.0.0" } }] },
      }))).rejects.toThrow(/dependency/i);
    });
  });

  it("does not allow a later private coordinate to shadow a shared dependency", async () => {
    await inStore(async (s) => {
      await s.publishPart(shared, pkg("part.pinned", "1.0.0"));
      await expect(s.publishPart(system("system.two"), pkg("part.pinned", "1.0.0", {
        visibility: "system-private", systemId: "system.two",
      }))).rejects.toThrow(/incompatible scope/i);
    });
  });
});
