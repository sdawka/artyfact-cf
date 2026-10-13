import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalRoute, providerFromEnv, translatorFromEnv, type RouteEvalReport, type RouteOrder, type Translator } from "../../src/index.ts";
import { assistant, ROUTE_FIXTURES, tidepool } from "./setup.ts";

/**
 * Real-provider routing eval. Skipped unless OPENROUTER_API_KEY is set. The decider comes from `providerFromEnv`
 * (`OPENROUTER_MODEL`), the translator from `translatorFromEnv` (`OPENROUTER_TRANSLATE_MODEL`, `TRANSLATE=0` skips
 * the translated run), the orders from `ROUTE_ORDER` (comma-separated `shortlist-first`, `intent-first`,
 * `intent-last`; default all three). Each run writes `test/fixtures/route/results.<model>[.<translate-model>].<order>.json` with the report:
 * every question, answer and distribution on each route path and the translator's raw reply. `expect.soft` keeps
 * low numbers recorded rather than aborting.
 *
 * Run: OPENROUTER_API_KEY=… npm run test:route:live -w @artyfact/ontology
 */
// Opt-in only, so `npm test` never calls a paid API just because a key is in the environment.
const KEY = process.env.ONTOLOGY_LIVE === "1" ? process.env.OPENROUTER_API_KEY?.trim() : undefined;
const ASK = { timeoutMs: 60_000, retries: 2, backoffMs: 2_000 };
const slug = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, "-");

if (!KEY) console.info("live routing eval skipped: set ONTOLOGY_LIVE=1 and OPENROUTER_API_KEY to run it");

describe.skipIf(!KEY)("live routing eval", () => {
  const s1 = providerFromEnv(process.env);
  const translator = translatorFromEnv(process.env);
  const translators: [string, Translator | undefined][] = [["route only", undefined], ...(translator.mode === "http" ? [["route + translate", translator] as [string, Translator]] : [])];
  const orders = (process.env.ROUTE_ORDER?.split(",").map((o) => o.trim()).filter(Boolean) ?? ["shortlist-first", "intent-first", "intent-last"]) as RouteOrder[];
  const runs = orders.flatMap((order) => translators.map(([label, t]) => [`${label}, ${order}`, t, order] as const));

  for (const [label, t, order] of runs) {
    it(`${label}: ${s1.model}${t ? ` + ${t.model}` : ""}`, { timeout: 1_800_000 }, async () => {
      const reports: RouteEvalReport[] = [];
      for (const s of [tidepool(), assistant()]) {
        const report = await evalRoute(s.cases, {
          graph: s.graph, template: s.template, s1, options: { ...s.options, order, ask: ASK }, concurrency: 2,
          ...(t && { translator: t, translate: { timeoutMs: 60_000, retries: 2, backoffMs: 2_000 } }),
        });
        reports.push(report);
        const tt = report.totals;
        console.info(`${s.name} ${label}: routed ${tt.routed.hit}/${tt.routed.total}, levels ${JSON.stringify(Object.fromEntries(Object.entries(tt.byLevel).map(([k, v]) => [k, v.rate])))}, `
          + `status ${JSON.stringify(tt.status)}, mean calls ${tt.meanCalls.toFixed(2)}${tt.translation ? `, translation ${JSON.stringify(tt.translation)}` : ""}`);
        expect.soft(tt.routed.rate ?? 0, `${s.name} routed`).toBeGreaterThanOrEqual(0.6);
      }
      const file = join(ROUTE_FIXTURES, `results.${slug(s1.model)}${t ? `.${slug(t.model)}` : ""}.${order}.json`);
      writeFileSync(file, `${JSON.stringify({ model: s1.model, translateModel: t?.model, order, at: new Date().toISOString(), reports }, null, 2)}\n`);
    });
  }
});
