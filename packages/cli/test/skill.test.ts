import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main";

const SKILLS = join(__dirname, "../skills/artyfact-genome");
const run = async (args: string[], cwd: string) => {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s), cwd, env: {} });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
const project = () => mkdtempSync(join(tmpdir(), "artyfact-skill-"));
const count = (text: string, part: string) => text.split(part).length - 1;

describe("artyfact skill", () => {
  it("prints the shipped SKILL.md", async () => {
    const r = await run(["skill"], project());
    expect(r.code).toBe(0);
    expect(`${r.out}\n`).toBe(readFileSync(join(SKILLS, "SKILL.md"), "utf8"));
    expect(r.out).toMatch(/^---\nname: artyfact-genome\n/);
  });

  it("separates accepted-import source preparation from existing-source authoring",async()=>{
    const r=await run(["skill"],project());
    expect(r.out).toContain("## Prepare an accepted import locally");
    expect(r.out).toContain("Genome-only");
    expect(r.out).toContain("--prepare-only");
    expect(r.out).toContain("server import validation");
    expect(r.out).toContain("--node <source-bound-node-id>");
    expect(r.out).not.toContain("create `plan.json`");
    expect(r.out).not.toContain("--no-review");
  });

  it("ships a SKILL.md of at most 180 lines", () => {
    expect(readFileSync(join(SKILLS, "SKILL.md"), "utf8").split("\n").length).toBeLessThanOrEqual(181);
  });

  it("--write installs the skill and one AGENTS.md block, idempotently", async () => {
    const dir = project();
    writeFileSync(join(dir, "AGENTS.md"), "# Mine\n\nKeep this.\n");
    mkdirSync(join(dir, ".claude"));
    const first = await run(["skill", "--write"], dir);
    expect(first).toMatchObject({ code: 0, err: "" });
    const skillDir = join(dir, ".claude/skills/artyfact-genome");
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf8")).toBe(readFileSync(join(SKILLS, "SKILL.md"), "utf8"));
    expect(readFileSync(join(skillDir, "reference/templates.md"), "utf8")).toBe(readFileSync(join(SKILLS, "reference/templates.md"), "utf8"));
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Mine\n\nKeep this.\n")).toBe(true);
    expect(count(agents, "<!-- artyfact-genome:start -->")).toBe(1);
    expect(agents).toContain(".claude/skills/artyfact-genome/SKILL.md");
    const second = await run(["skill", "--write"], dir);
    expect(second.code).toBe(0);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(agents);
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf8")).toBe(readFileSync(join(SKILLS, "SKILL.md"), "utf8"));
  });

  it("keeps the existing artyfact AGENTS.md block apart from the skill block", async () => {
    const dir = project();
    writeFileSync(join(dir, "AGENTS.md"), "<!-- artyfact:start -->\nold\n<!-- artyfact:end -->\n");
    await run(["skill", "--write", "--agent", "claude", "--dir", dir], dir);
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("<!-- artyfact:start -->\nold\n<!-- artyfact:end -->");
    expect(count(agents, "<!-- artyfact-genome:start -->")).toBe(1);
  });

  it("generic mode writes only AGENTS.md with the skill inline", async () => {
    const dir = project();
    const r = await run(["skill", "--write", "--agent", "generic", "--dir", dir], process.cwd());
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("## 4. Validate until clean");
    expect(agents).not.toContain("name: artyfact-genome");
    const again = await run(["skill", "--write", "--agent", "generic", "--dir", dir], process.cwd());
    expect(again.code).toBe(0);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(agents);
  });

  it("defaults to generic without a .claude directory", async () => {
    const dir = project();
    await run(["skill", "--write"], dir);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });

  it("refuses symlinked targets", async () => {
    const dir = project();
    const elsewhere = project();
    writeFileSync(join(elsewhere, "real.md"), "keep");
    symlinkSync(join(elsewhere, "real.md"), join(dir, "AGENTS.md"));
    const r = await run(["skill", "--write", "--agent", "generic"], dir);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/refusing to write through symlink/);
    expect(readFileSync(join(elsewhere, "real.md"), "utf8")).toBe("keep");

    const dir2 = project();
    mkdirSync(join(dir2, ".claude/skills"), { recursive: true });
    symlinkSync(elsewhere, join(dir2, ".claude/skills/artyfact-genome"));
    const r2 = await run(["skill", "--write", "--agent", "claude"], dir2);
    expect(r2.code).toBe(1);
    expect(r2.err).toMatch(/refusing to write through symlink/);
    expect(existsSync(join(elsewhere, "SKILL.md"))).toBe(false);
    expect(lstatSync(join(dir2, ".claude/skills/artyfact-genome")).isSymbolicLink()).toBe(true);

    const dir3 = project();
    mkdirSync(join(dir3, ".claude/skills/artyfact-genome/reference"), { recursive: true });
    writeFileSync(join(elsewhere, "t.md"), "keep");
    symlinkSync(join(elsewhere, "t.md"), join(dir3, ".claude/skills/artyfact-genome/SKILL.md"));
    expect((await run(["skill", "--write", "--agent", "claude"], dir3)).code).toBe(1);
    expect(readFileSync(join(elsewhere, "t.md"), "utf8")).toBe("keep");
  });

  it("rejects an unknown agent and stray arguments", async () => {
    expect((await run(["skill", "--agent", "cursor"], project())).err).toMatch(/unknown agent/);
    expect((await run(["skill", "extra"], project())).err).toMatch(/usage: artyfact skill/);
  });
});
