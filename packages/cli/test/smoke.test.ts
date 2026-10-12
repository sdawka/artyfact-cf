import { describe, expect, it } from "vitest";
import { name } from "../src/index";

describe("@artyfact/cli", () => {
  it("loads", () => {
    expect(name).toBe("@artyfact/cli");
  });
});
