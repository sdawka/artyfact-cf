import { describe, expect, it } from "vitest";
import { name } from "../src/index";

describe("@artyfact/model", () => {
  it("loads", () => {
    expect(name).toBe("@artyfact/model");
  });
});
