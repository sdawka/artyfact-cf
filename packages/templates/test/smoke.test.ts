import { describe, expect, it } from "vitest";
import { name } from "../src/index";

describe("@artyfact/templates", () => {
  it("loads", () => {
    expect(name).toBe("@artyfact/templates");
  });
});
