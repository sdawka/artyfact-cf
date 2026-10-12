import { describe, expect, it } from "vitest";
import { name } from "../src/index";

describe("@artyfact/semantic", () => {
  it("loads", () => {
    expect(name).toBe("@artyfact/semantic");
  });
});
