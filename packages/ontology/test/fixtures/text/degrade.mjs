// Regenerates the sloppy-content fixtures from the real ones: node test/fixtures/text/degrade.mjs
// Each entry is one degraded node: [id, field, value]. The expected findings live in test/text.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument, Scalar } from "yaml";

const here = (p) => new URL(p, import.meta.url);

export const KIT = [
  ["screen.signin", "description", ""],
  ["screen.today", "description", "   "],
  ["entity.Account", "description", "TBD"],
  ["entity.Block", "description", "todo: fill in"],
  ["operation.contact.save", "description", "Lorem ipsum dolor sit amet"],
  ["policy.ownerOnly", "description", "N/A"],
  ["entity.Suggestion", "description", "Suggestion"],
  ["operation.goal.save", "description", "Saves."],
  ["component.PrimaryNav", "name", "component.PrimaryNav"],
  ["component.TodayHeading", "name", "Component TodayHeading"],
];

export const TIDEPOOL = [
  ["purpose-turn-volunteer-shore-walks-into-survey", "title", "Data"],
  ["audience-weekend-shore-volunteer", "title", ""],
  ["audience-marine-biologist-running-a-monitoring", "title", "  "],
  ["context-rocky-intertidal-sites-with-no-mobile", "title", "TBD"],
  ["capability-field-capture", "title", "capability field capture"],
  ["capability-expert-verification", "title", "TODO"],
  ["summary-an-offline-first-field-app-for-timed", "description", "Lorem ipsum"],
  ["feature-low-tide-reminders", "description", "to be determined"],
  ["thing-observation", "title", "thing-observation"],
  ["thing-quadrat", "title", "???"],
];

function degradeYaml(src, edits) {
  const doc = parseDocument(src);
  const left = new Map(edits.map(([id, f, v]) => [id, [f, v]]));
  const walk = (seq) => {
    for (const n of seq?.items ?? []) {
      const id = n.get("id");
      if (left.has(id)) {
        const [f, v] = left.get(id);
        const s = new Scalar(v);
        s.type = Scalar.QUOTE_DOUBLE;
        n.set(f, s);
        left.delete(id);
      }
      walk(n.get("children"));
    }
  };
  walk(doc.get("nodes"));
  if (left.size) throw new Error(`not found: ${[...left.keys()]}`);
  return "# Degraded copy of keep-in-touch-system/things/webapp/ontology.yaml; regenerate with degrade.mjs.\n" + doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

function degradeJson(json, edits) {
  for (const [id, f, v] of edits) {
    const n = json.nodes.find((x) => x.id === id);
    if (!n) throw new Error(`not found: ${id}`);
    n[f] = v;
  }
  return JSON.stringify(json, null, 2) + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(here("./kit.ontology.sloppy.yaml"),
    degradeYaml(readFileSync(here("../artyfact/keep-in-touch-system/things/webapp/ontology.yaml"), "utf8"), KIT));
  writeFileSync(here("./tidepool.sloppy.graph.json"),
    degradeJson(JSON.parse(readFileSync(here("../product/tidepool.graph.json"), "utf8")), TIDEPOOL));
}
