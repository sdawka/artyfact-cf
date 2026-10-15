import { describe, expect, it } from "vitest";
import { HttpError, rpc } from "../worker/errors";

describe("rpc", () => {
  it("returns resolved values without losing object identity", async () => {
    const value = { id: "plan.1" };
    expect(await rpc(Promise.resolve(value))).toBe(value);
  });

  it("accepts synchronous values and undefined results", async () => {
    expect(await rpc(7)).toBe(7);
    expect(await rpc(Promise.resolve())).toBeUndefined();
  });

  it.each([
    ["not-found", 404], ["invalid-state", 409], ["stale-base", 409],
    ["verification-required", 409],
  ] as const)("maps %s RPC failures to HTTP %i", async (code, status) => {
    const result = rpc(Promise.reject(new Error(`[${code}] first line\nsecond line`)));
    await expect(result).rejects.toBeInstanceOf(HttpError);
    await expect(result).rejects.toMatchObject({ status, code, message: "first line\nsecond line" });
  });

  it.each([
    new Error("unrecognized failure"), new HttpError(403, "forbidden", "denied"),
    "raw rejection", null,
  ])("preserves unrecognized rejection identity (%s)", async (error) => {
    await expect(rpc(Promise.reject(error))).rejects.toBe(error);
  });
});
