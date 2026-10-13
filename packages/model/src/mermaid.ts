import type { Journey, JourneyStep } from "./schema.ts";

const RESERVED = new Set(["end", "graph", "subgraph", "flowchart", "style", "class", "click", "direction"]);
const nodeId = (id: string) => {
  const s = id.replace(/[^\w]/g, "_");
  return RESERVED.has(s.toLowerCase()) ? `${s}_` : s;
};
const label = (s: string) => `"${s.replace(/"/g, "#quot;")}"`;
const shape = (s: JourneyStep) => {
  const l = label(s.action);
  switch (s.kind) {
    case "branch": return `{${l}}`;
    case "end": return `([${l}])`;
    case "wait": return `[/${l}/]`;
    case "failure": return `[[${l}]]`;
    default: return `[${l}]`;
  }
};

/** Mermaid flowchart projection of a Journey (debug/docs; the UI renders journeys with React Flow). */
export function toMermaid(j: Journey): string {
  const lines = ["flowchart LR"];
  for (const s of j.steps) lines.push(`  ${nodeId(s.id)}${shape(s)}`);
  for (const s of j.steps) {
    for (const n of s.next) lines.push(`  ${nodeId(s.id)} -->${n.when ? `|${n.when.replace(/[|"]/g, "")}|` : ""} ${nodeId(n.to)}`);
  }
  const failures = j.steps.filter((s) => s.kind === "failure").map((s) => nodeId(s.id));
  if (failures.length) lines.push("  classDef failure stroke-dasharray: 4 2", `  class ${failures.join(",")} failure`);
  return lines.join("\n");
}
