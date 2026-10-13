import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSLATE_MODEL, fakeTranslator, offTranslator, openRouterTranslator, parseTranslation, route, routeSlice, scriptedSystemOne,
  titleOf, translatorFromEnv, validateOps, type Graph, type Op, type RouteVocabularySource, type TranslateInput,
} from "../../src/index.ts";
import { assistant, tidepool } from "./setup.ts";

const tp = tidepool();
const ws = assistant();

async function input(answers: Record<string, string>, message = "Rename the species picker to 'Species chooser'."): Promise<TranslateInput> {
  const r = await route(tp.graph, tp.template, message, scriptedSystemOne(answers), { ...tp.options, order: "intent-last" });
  return { message, route: r, slice: routeSlice(tp.graph, r) };
}
const SCREEN = { "route.intent": "update", "route.space": "solution", "route.kind": "screen", "route.node": "screen-species-picker", "route.more": "no" };

function chat(content: unknown, status = 200) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const body = typeof content === "function" ? (content as () => unknown)() : content;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const reply = (text: string) => ({ model: "m/x", choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe("parseTranslation", () => {
  it("reads ops, a question or an answer, inside one optional code fence", () => {
    expect(parseTranslation('{"ops":[{"op":"remove","id":"a"}]}')).toEqual({ ops: [{ op: "remove", id: "a" }] });
    expect(parseTranslation('```json\n{"question":"Which one?"}\n```')).toEqual({ question: "Which one?" });
    expect(parseTranslation('{"answer":"Volunteers."}')).toEqual({ answer: "Volunteers." });
  });
  it("reads add fields and criteria, and update criteria without fields", () => {
    const add = { op: "add", kind: "screen", title: "T", fields: { route: "/t" }, criteria: [{ id: "C.t", claim: "T shows." }] };
    const update = { op: "update", id: "a", criteria: [{ id: "C.t", remove: true }] };
    expect(parseTranslation(JSON.stringify({ ops: [add, update] }))).toEqual({ ops: [add, update] });
    expect(parseTranslation('{"ops":[{"op":"update","id":"a","criteria":[{"claim":"no id"}]}]}')).toHaveProperty("error");
  });
  it("reads update files, a list or null", () => {
    const ops = [{ op: "update", id: "a", files: ["src/x/**", "*.ts"] }, { op: "update", id: "b", files: null }];
    expect(parseTranslation(JSON.stringify({ ops }))).toEqual({ ops });
    expect(parseTranslation('{"ops":[{"op":"update","id":"a","files":"src"}]}')).toHaveProperty("error");
  });
  it("rejects prose, empty objects, unknown ops and add links naming both ends", () => {
    expect(parseTranslation("Sure! Here you go")).toEqual({ error: "translator reply is not JSON" });
    expect(parseTranslation("{}")).toHaveProperty("error");
    expect(parseTranslation('{"ops":[{"op":"rename","id":"a"}]}')).toHaveProperty("error");
    expect(parseTranslation('{"ops":[{"op":"add","kind":"k","title":"t","links":[{"rel":"r","to":"a","from":"b"}]}]}')).toHaveProperty("error");
  });
});

describe("openRouterTranslator", () => {
  it("sends the route, slice and vocabulary but never the whole graph, and parses the reply", async () => {
    const { f, calls } = chat(reply('{"ops":[{"op":"update","id":"screen-species-picker","fields":{"title":"Species chooser"}}]}'));
    const t = openRouterTranslator({ apiKey: "sk-secret", fetch: f });
    const inp = await input(SCREEN);
    const out = await t.translate(inp);
    expect(out).toMatchObject({ provider: "openrouter", model: "m/x", ops: [{ op: "update", id: "screen-species-picker" }], usage: { input_tokens: 10, output_tokens: 5 } });
    expect(calls[0]!.body.model).toBe(DEFAULT_TRANSLATE_MODEL);
    expect(calls[0]!.headers.Authorization).toBe("Bearer sk-secret");
    const user = JSON.parse(calls[0]!.body.messages[1].content);
    expect(Object.keys(user).sort()).toEqual(["message", "route", "slice"]);
    expect(user.slice.nodes.length).toBeLessThan(tp.graph.nodes.length / 3);
    await t.translate(inp);
    expect(calls).toHaveLength(1); // cached
  });
  it("returns an error with the raw reply when it does not parse, and does not cache it", async () => {
    const { f, calls } = chat(reply("I think you should rename it."));
    const t = openRouterTranslator({ apiKey: "sk-test-key", fetch: f });
    const inp = await input(SCREEN);
    const out = await t.translate(inp);
    expect(out).toMatchObject({ provider: "error", error: "translator reply is not JSON", raw: "I think you should rename it." });
    await t.translate(inp);
    expect(calls).toHaveLength(2);
  });
  it("retries server errors, then reports them with the key redacted", async () => {
    const { f, calls } = chat({ error: { message: "bad key sk-secret" } }, 500);
    const out = await openRouterTranslator({ apiKey: "sk-secret", fetch: f }).translate(await input(SCREEN), { retries: 1, backoffMs: 1 });
    expect(calls).toHaveLength(2);
    expect(out.provider).toBe("error");
    expect(out.error).toContain("[redacted]");
    expect(out.error).not.toContain("sk-secret");
  });
});

describe("fake and off translators", () => {
  it("fake: an update of the first target when confident, a question otherwise", async () => {
    const t = fakeTranslator();
    expect((await t.translate(await input(SCREEN))).ops).toEqual([{ op: "update", id: "screen-species-picker", fields: { description: expect.stringContaining("[fake]") } }]);
    expect((await t.translate(await input({ "route.intent": "question" }))).question).toMatch(/\[fake\]/);
    expect((await t.translate(await input({ "route.intent": "update", "route.space": "none" }))).question).toMatch(/\[fake\]/);
    const add = await t.translate(await input({ "route.intent": "add", "route.space": "hypothesis", "route.kind": "metric", "route.node": "none" }));
    expect(add.ops?.[0]).toMatchObject({ op: "add", kind: "metric" });
    expect((await t.translate(await input({ "route.intent": "answer", "route.space": "problem", "route.kind": "audience", "route.node": "audience-weekend-shore-volunteer", "route.more": "no" }))).answer).toMatch(/audience-weekend/);
  });
  it("fake: a #files: directive updates the first target's files", async () => {
    const t = fakeTranslator();
    const out = await t.translate(await input(SCREEN, "Bind the picker #files:src/picker/**,lib/*.ts"));
    expect(out.ops).toEqual([{ op: "update", id: "screen-species-picker", files: ["src/picker/**", "lib/*.ts"] }]);
  });
  it("fake: an add links to the first target only with a relation the vocabulary declares for the two kinds", async () => {
    const base = await input({ "route.intent": "add", "route.space": "solution", "route.kind": "screen", "route.node": "screen-species-picker", "route.more": "no" });
    expect(base.route.target).toMatchObject({ kind: "screen", nodes: ["screen-species-picker"] });
    const vocabulary = (relations: Record<string, { from: string[]; to: string[] }>) => ({ kinds: ["screen"], relations });
    const add = async (relations: Record<string, { from: string[]; to: string[] }>) =>
      (await fakeTranslator().translate({ ...base, vocabulary: vocabulary(relations) })).ops?.[0];
    expect(await add({ navigatesTo: { from: ["screen"], to: ["screen"] } })).toMatchObject({ links: [{ rel: "navigatesTo", to: "screen-species-picker" }] });
    expect(await add({ shows: { from: ["module"], to: ["screen"] } })).not.toHaveProperty("links");
    expect(await add({})).not.toHaveProperty("links");
  });
  it("off translates nothing", async () => {
    expect(await offTranslator().translate(await input(SCREEN))).toEqual({ model: "off", provider: "off" });
  });
  it("env precedence: TRANSLATE=0, then FAKE_S1=1, then an OpenRouter key, else off", () => {
    expect(translatorFromEnv({ TRANSLATE: "0", FAKE_S1: "1", OPENROUTER_API_KEY: "k" }).mode).toBe("off");
    expect(translatorFromEnv({ FAKE_S1: "1", OPENROUTER_API_KEY: "k" }).mode).toBe("fake");
    expect(translatorFromEnv({ OPENROUTER_API_KEY: " k " })).toMatchObject({ mode: "http", model: DEFAULT_TRANSLATE_MODEL });
    expect(translatorFromEnv({ OPENROUTER_API_KEY: "k", OPENROUTER_TRANSLATE_MODEL: "x/y" }).model).toBe("x/y");
    expect(translatorFromEnv({}).mode).toBe("off");
  });
});

describe("titleOf", () => {
  it("falls back from title to name, then the kind's view.title field, then the id", () => {
    const t: RouteVocabularySource = { kinds: { step: { view: { title: "label" } } }, relations: {} };
    const n = (fields: Record<string, unknown>) => ({ id: "J/s1", kind: "step", fields });
    expect(titleOf(n({ title: "T", name: "N", label: "L" }), t)).toBe("T");
    expect(titleOf(n({ name: "N", label: "L" }), t)).toBe("N");
    expect(titleOf(n({ label: "L" }), t)).toBe("L");
    expect(titleOf(n({ label: "L" }))).toBe("J/s1");
  });
});

describe("validateOps", () => {
  const rules = (ops: Op[], s = tp) => validateOps(ops, s.template, s.graph).map((p) => `${p.level} ${p.rule} ${p.op}`);
  it("accepts well-formed ops", () => {
    expect(rules([
      { op: "update", id: "screen-species-picker", fields: { title: "Species chooser" } },
      { op: "add", kind: "test", title: "Survey started 120 minutes before low tide is rejected", links: [{ rel: "verifies", to: "rule-surveys-start-no-earlier-than-90-minutes" }] },
      { op: "add", kind: "event", title: "Survey abandoned", links: [{ rel: "contains", from: "module-field-capture-app" }] },
      { op: "unlink", from: "module-field-capture-app", rel: "exposes", to: "screen-site-map" },
      { op: "link", from: "module-verification-service", rel: "exposes", to: "screen-site-map" },
      { op: "remove", id: "feature-low-tide-reminders" },
    ])).toEqual([]);
  });
  it("flags unknown nodes, kinds and relations, illegal endpoints and duplicate titles as errors", () => {
    expect(rules([
      { op: "remove", id: "nope" },
      { op: "add", kind: "widget", title: "X" },
      { op: "add", kind: "screen", title: "species  PICKER" },
      { op: "link", from: "rule-a-record-has-exactly-one-final-verdict", rel: "verifies", to: "test-second-verdict-on-a-record-is-rejected" },
      { op: "link", from: "screen-site-map", rel: "likes", to: "screen-species-picker" },
      { op: "add", kind: "test", title: "New", links: [{ rel: "verifies", to: "screen-site-map" }] },
    ])).toEqual([
      "error op.unknownNode 0", "error op.unknownKind 1", "error op.duplicateTitle 2", "error op.relationEndpoint 3",
      "error op.unknownRelation 4", "error op.relationEndpoint 5",
    ]);
  });
  it("warns on undeclared fields, missing unlinks and existing links", () => {
    expect(rules([
      { op: "update", id: "screen-species-picker", fields: { colour: "red" } },
      { op: "unlink", from: "module-verification-service", rel: "exposes", to: "screen-site-map" },
      { op: "link", from: "module-field-capture-app", rel: "exposes", to: "screen-site-map" },
    ])).toEqual(["warning op.unknownField 0", "warning op.missingLink 1", "warning op.duplicateLink 2"]);
  });
  it("checks add fields and criteria, update criteria, and an update with nothing to change", () => {
    const g: Graph = {
      template: "t", declarations: [], evidence: [],
      nodes: [
        { id: "sys", kind: "system", fields: {} },
        { id: "s1", kind: "screen", parent: "sys", fields: { name: "People" } },
        { id: "s2", kind: "screen", parent: "sys", fields: {} },
        { id: "C.s1", kind: "criterion", fields: {} },
      ],
      links: [{ from: "C.s1", rel: "subject", to: "s1" }],
    };
    const t: RouteVocabularySource = { kinds: { system: {}, screen: { fields: [{ name: "name" }, { name: "route" }] }, criterion: {} }, relations: {} };
    const check = (ops: Op[]) => validateOps(ops, t, g).map((p) => `${p.level} ${p.rule} ${p.op}`);
    const claim = "It holds.";
    expect(check([
      { op: "add", kind: "screen", title: "Today", fields: { route: "/today" }, criteria: [{ id: "C.today", claim }] },
      { op: "update", id: "s1", criteria: [{ id: "C.s1", claim }, { id: "C.s1.more", claim, severity: "soft" }] },
      { op: "update", id: "s1", criteria: [{ id: "C.s1", remove: true }] },
    ])).toEqual([]);
    expect(check([
      { op: "add", kind: "screen", title: "people", fields: { colour: "red" } },
      { op: "add", kind: "screen", title: "X", criteria: [{ id: "C.s1", claim }] },
      { op: "update", id: "s2", criteria: [{ id: "C.s1", remove: true }, { id: "bad", claim }] },
      { op: "update", id: "s2", fields: {} },
    ])).toEqual([
      "error op.duplicateTitle 0", "warning op.unknownField 0", "error op.duplicateCriterion 1",
      "error op.unknownCriterion 2", "error op.invalidCriterion 2", "error op.emptyUpdate 3",
    ]);
    expect(check([
      { op: "update", id: "s2", files: ["src/**"] },
      { op: "update", id: "s2", files: null },
      { op: "update", id: "s2", files: [] },
      { op: "update", id: "s2", files: ["../x", "/abs", "ok/**"] },
      { op: "update", id: "sys", files: ["src/**"] },
      { op: "update", id: "sys", files: null },
    ])).toEqual(["error op.invalidFile 3", "error op.invalidFile 3", "warning op.filesOnTemplateRoot 4"]);
  });
  it("gold ops of both case files carry no errors", () => {
    for (const s of [tp, ws]) {
      const errors = s.cases.cases.flatMap((c) => validateOps((c.gold.ops ?? []) as Op[], s.template, s.graph)
        .filter((p) => p.level === "error").map((p) => `${c.id} ${p.rule} ${p.message}`));
      expect(errors, s.name).toEqual([]);
    }
  });
});

