import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_TOKEN_KEY, useAdminToken, useAdminTokenField } from "./adminToken";

afterEach(() => {
  vi.restoreAllMocks();
  const { result } = renderHook(() => useAdminToken());
  act(() => result.current.clear());
  sessionStorage.clear();
});

describe("useAdminToken", () => {
  it("sets, gets and clears through sessionStorage only", () => {
    const { result } = renderHook(() => useAdminToken());
    expect(result.current.token).toBe("");
    act(() => result.current.setToken("  adm_1 "));
    expect(result.current.token).toBe("adm_1");
    expect(sessionStorage.getItem(ADMIN_TOKEN_KEY)).toBe("adm_1");
    expect(localStorage.length).toBe(0);
    act(() => result.current.clear());
    expect(result.current.token).toBe("");
    expect(sessionStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it("shares the token between hook instances", () => {
    const a = renderHook(() => useAdminToken());
    const b = renderHook(() => useAdminToken());
    act(() => a.result.current.setToken("shared"));
    expect(b.result.current.token).toBe("shared");
  });

  it("falls back to memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useAdminToken());
    act(() => result.current.setToken("mem"));
    expect(result.current.token).toBe("mem");
    act(() => result.current.clear());
    expect(result.current.token).toBe("");
  });
});

describe("useAdminTokenField", () => {
  it("pre-fills from the saved token, lets a one-off override it, and reset returns to it", () => {
    const admin = renderHook(() => useAdminToken());
    act(() => admin.result.current.setToken("saved"));
    const { result } = renderHook(() => useAdminTokenField());
    expect(result.current[0]).toBe("saved");
    act(() => result.current[1]("other"));
    expect(result.current[0]).toBe("other");
    act(() => result.current[2]());
    expect(result.current[0]).toBe("saved");
  });
});
