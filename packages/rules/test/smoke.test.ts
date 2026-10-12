import { describe, expect, it } from "vitest";
import { name } from "../src/index";

describe("@artyfact/rules", () => {
  it("loads", () => {
    expect(name).toBe("@artyfact/rules");
  });
});
