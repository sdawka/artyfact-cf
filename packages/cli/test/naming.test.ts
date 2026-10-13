import { describe, expect, it } from "vitest";
import { appRepoName, forkName, genomeRepoName, itestPrefix, PLATFORM_REPO, slug, systemRepoNames } from "../src/naming.ts";

describe("naming", () => {
  it("derives the slug from the system id", () => {
    expect(slug("system.peopling")).toBe("peopling");
    expect(slug("system.peo_pling.x")).toBe("peo_pling.x");
    for (const bad of ["system.a b/c!", "system.-.x", "system.a/b", "system.Ünïcode", "system.a..b", "system._x", "system.Peopling", "system.Peo_Pling.X"]) expect(() => slug(bad), bad).toThrow(/slug/);
    expect(slug("plain")).toBe("plain");
    expect(() => slug("system.")).toThrow(/slug/);
    expect(() => slug("system.--")).toThrow(/slug/);
  });

  it("names genome, app, forks, platform and itest repos", () => {
    expect(genomeRepoName("peopling")).toBe("peopling.genome");
    expect(appRepoName("peopling")).toBe("peopling.app");
    expect(appRepoName("peopling", "artifact.webapp")).toBe("peopling.app");
    expect(appRepoName("peopling", "artifact.admin", true)).toBe("peopling.admin");
    expect(forkName("peopling.app", 3)).toBe("peopling.app--r3");
    expect(forkName("peopling.genome", 4)).toBe("peopling.genome--r4");
    expect(PLATFORM_REPO).toBe("platform");
    expect(itestPrefix("peopling", "ab12")).toBe("itest-peopling-ab12");
  });

  it("names a System's repos from its artifacts", () => {
    expect(systemRepoNames("system.peopling", ["artifact.webapp"])).toEqual({
      slug: "peopling", genomeRepo: "peopling.genome", appRepo: "peopling.app",
    });
    expect(systemRepoNames("system.shop", ["artifact.storefront", "artifact.admin"]).appRepo).toBe("shop.storefront");
  });
});

describe("platform layout", () => {
  it("maps template refs and rule packs to platform paths", async () => {
    const { platformPackFile, platformTemplateDir } = await import("../src/naming.ts");
    expect(platformTemplateDir("template.thing.cloudflare-worker-webapp@1")).toBe("templates/thing/cloudflare-worker-webapp@1");
    expect(platformTemplateDir("template.system.social-networking.cloudflare@1")).toBe("templates/system/social-networking.cloudflare@1");
    expect(platformTemplateDir("nope")).toBeUndefined();
    expect(platformPackFile("topology.private-pairs", "1")).toBe("templates/rule-packs/topology.private-pairs@1/pack.dl");
  });
});
