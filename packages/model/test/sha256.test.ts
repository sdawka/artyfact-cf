import { describe, expect, it } from "vitest";
import { sha256 } from "../src/sha256";

describe("sha256", () => {
  it("matches known vectors", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
});

describe("sha256 utf-8", () => {
  it("encodes multi-byte text", () => {
    expect(sha256("héllo ✓ 🎉")).toBe("48585dc95ecc1a6f2c579315e578d8a2f58ad77dfabe1888cfeb963898790056");
  });
});
