import { describe, expect, it } from "vitest";
import { schema, toMermaid } from "../src/index";
import { load } from "./helpers";

describe("toMermaid", () => {
  const j = load().journeys[0];

  it("renders a left-to-right flowchart with step ids and branch labels", () => {
    const out = toMermaid(j);
    expect(out.split("\n")[0]).toBe("flowchart LR");
    for (const id of ["s1", "s2", "s3", "e1"]) expect(out).toContain(id);
    expect(out).toContain("s2 -->|yes| s3");
    expect(out).toContain("s2 -->|no| e1");
    expect(out).toContain('s2{"Has something to write?"}');
  });

  it("escapes labels and reserved ids", () => {
    const k = schema.Journey.parse({
      id: "J.x", name: "x", actorGoal: "g", features: [], requirements: [], start: "end",
      steps: [{ id: "end", actor: "user", action: 'Say "hi"', kind: "end" }],
    });
    const out = toMermaid(k);
    expect(out).toContain("#quot;hi#quot;");
    expect(out).not.toMatch(/^\s*end\b/m);
  });
});
