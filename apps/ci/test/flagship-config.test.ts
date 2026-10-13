import { describe, expect, it } from "vitest";
import { bundleConfig, deployConfig, parseFlagshipAppIds, systemFlagshipAppIds, validateRepoConfig } from "../src/deploy-config";
const raw = (flagship: unknown) => JSON.stringify({ main: "src/index.ts", compatibility_date: "2026-10-13", flagship });
describe("native Flagship deploy bindings", () => {
  it("copies only configured same-System Flagship apps into bundle and deploy configs", () => {
    const spec = validateRepoConfig("wrangler.json", raw([{ binding: "FLAGS", app_id: "app-demo" }]), { accountId: "account", flagshipAppIds: { FLAGS: "app-demo" } });
    expect(spec.copied.flagship).toEqual([{ binding: "FLAGS", app_id: "app-demo" }]);
    expect(deployConfig(spec, { workerName: "demo", accountId: "account", nonce: "nonce" }).flagship).toEqual(spec.copied.flagship);
    expect(bundleConfig(spec, { workerName: "demo", accountId: "account" }).flagship).toEqual(spec.copied.flagship);
  });
  it("rejects foreign or unconfigured apps and extra binding fields", () => {
    expect(() => validateRepoConfig("wrangler.json", raw([{ binding: "FLAGS", app_id: "other" }]), { accountId: "account", flagshipAppIds: { FLAGS: "app-demo" } })).toThrow(/Flagship/);
    expect(() => validateRepoConfig("wrangler.json", raw([{ binding: "FLAGS", app_id: "app-demo" }]), { accountId: "account" })).toThrow(/Flagship/);
    expect(() => validateRepoConfig("wrangler.json", raw([{ binding: "FLAGS", app_id: "app-demo", remote: true }]), { accountId: "account", flagshipAppIds: { FLAGS: "app-demo" } })).toThrow(/field/);
    expect(() => validateRepoConfig("wrangler.json", raw([{ binding: "FLAGS", app_id: "app-demo" }, { binding: "FLAGS", app_id: "app-demo" }]), { accountId: "account", flagshipAppIds: { FLAGS: "app-demo" } })).toThrow(/duplicate/);
  });
  it("parses server configuration fail closed and scopes the map to the System", () => {
    const parsed = parseFlagshipAppIds('{"system.demo":{"FLAGS":"app-demo"},"bad":{"FLAGS":42}}');
    expect(systemFlagshipAppIds(parsed, "system.demo")).toEqual({ FLAGS: "app-demo" });
    expect(systemFlagshipAppIds(parsed, "other")).toEqual({});
    expect(parseFlagshipAppIds("malformed")).toEqual({});
  });
});
