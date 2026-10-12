import { describe, expect, it } from "vitest";
import { appRepoName, forkName, genomeRepoName, itestPrefix, PLATFORM_REPO, slug, systemRepoNames } from "../src/naming.ts";

describe("naming", () => {
  it("derives the slug from the system id", () => {
    expect(slug("system.keep-in-touch")).toBe("keep-in-touch");
    expect(slug("system.Keep_In.Touch")).toBe("keep_in.touch");
    expect(slug("system.a b/c!")).toBe("abc");
    expect(slug("system.-.x")).toBe("x");
    expect(slug("plain")).toBe("plain");
    expect(() => slug("system.")).toThrow(/slug/);
    expect(() => slug("system.--")).toThrow(/slug/);
  });

  it("names genome, app, forks, platform and itest repos", () => {
    expect(genomeRepoName("keep-in-touch")).toBe("keep-in-touch.genome");
    expect(appRepoName("keep-in-touch")).toBe("keep-in-touch.app");
    expect(appRepoName("keep-in-touch", "artifact.webapp")).toBe("keep-in-touch.app");
    expect(appRepoName("keep-in-touch", "artifact.admin", true)).toBe("keep-in-touch.admin");
    expect(forkName("keep-in-touch.app", 3)).toBe("keep-in-touch.app--r3");
    expect(forkName("keep-in-touch.genome", 4)).toBe("keep-in-touch.genome--r4");
    expect(PLATFORM_REPO).toBe("platform");
    expect(itestPrefix("keep-in-touch", "ab12")).toBe("itest-keep-in-touch-ab12");
  });

  it("names a System's repos from its artifacts", () => {
    expect(systemRepoNames("system.keep-in-touch", ["artifact.webapp"])).toEqual({
      slug: "keep-in-touch", genomeRepo: "keep-in-touch.genome", appRepo: "keep-in-touch.app",
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
