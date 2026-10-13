import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/sha256";
import * as rules from "../src/index.ts";

describe("sha256", () => {
  it("matches known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // multi-block input with 2-, 3- and 4-byte UTF-8 sequences (reference: node:crypto)
    expect(sha256Hex("a".repeat(1000) + "é✓😀")).toBe("aea1033432ea7bc4fa19ad2fa2d12b4df7266497c76a766403fe69a3819ea35d");
  });

  it("is exported from the package entry", () => {
    expect(rules.sha256Hex).toBe(sha256Hex);
  });
});
