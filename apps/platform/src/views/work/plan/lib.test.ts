import { describe, expect, it } from "vitest";
import { blockedOn, caseTwinReason, CLI_ID_REASON, cliId, commandLines, shellArg, conflictsOf, displayStatus, footprintLine, integrateReason, planCountsLine, planError, taskCommand, waveOf, whyWave } from "./lib";
import { workWaiting } from "./signals";
import { attempt, makePlan, NOW, task } from "./testPlan";

describe("plan lib", () => {
  it("labels waves from 1 and counts", () => {
    const p = makePlan();
    expect(waveOf(p, "t1")).toBe(1);
    expect(waveOf(p, "t3")).toBe(2);
    expect(waveOf(p, "nope")).toBeNull();
    expect(planCountsLine(p)).toBe("3 tasks · 2 waves");
  });

  it("blocks a pending task until every dependency is selected", () => {
    const p = makePlan();
    const t3 = p.tasks[2]!;
    expect(blockedOn(t3, p)).toEqual(["t1", "t2"]);
    expect(displayStatus(t3, p)).toBe("blocked");
    const done = makePlan({ tasks: [task("t1", { status: "selected", selectedCandidate: "c1" }), task("t2", { status: "selected", selectedCandidate: "c2" }), t3] });
    expect(displayStatus(t3, done)).toBe("pending");
  });

  it("gives claim lines with no credential, refuses t3 before t1 and t2 are selected, resumes a lapsed lease", () => {
    const p = makePlan();
    const c1 = taskCommand(p, p.tasks[0]!, NOW);
    const claim = 'ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim plan.one t1 --system system.peopling --dir ./work/t1';
    const agent = "( cd ./work/t1 && env -u ARTYFACT_ADMIN_TOKEN claude -p 'Follow AGENTS.md and TASK_PACKET.md, then run npx artyfact task submit' )";
    expect(c1).toEqual({ verb: "claim", line: `${claim}\n${agent}`, lines: { claim, agent } });
    expect(c1.verb && c1.line).not.toMatch(/--json/);
    // The claim reads the token from the non-exported $ADMIN_TOKEN and `env -u` unsets it for the agent; no value appears.
    expect((c1 as { line: string }).line.replaceAll('ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN"', "")).not.toMatch(/TOKEN=|secret|Bearer/i);
    expect(taskCommand(p, p.tasks[2]!, NOW)).toEqual({ verb: null, reason: "Waits until “Task t1”, “Task t2” are selected." });
    const lapsed = makePlan({ tasks: [task("t1", { status: "working", attempts: [attempt({ leaseExpiresAt: new Date(NOW - 1).toISOString() })] }), task("t2")] });
    expect(taskCommand(lapsed, lapsed.tasks[0]!, NOW)).toMatchObject({ verb: "resume" });
    const live = makePlan({ tasks: [task("t1", { status: "working", attempts: [attempt()] }), task("t2")] });
    expect(taskCommand(live, live.tasks[0]!, NOW)).toEqual({ verb: null, reason: `claude holds it until ${new Date(NOW + 600_000).toISOString()}.` });
  });

  it("shell-quotes every server-supplied value in copied commands", () => {
    const hostile = ["x;rm -rf ~", "$(id)", "a`id`b", "it's", "a\nb", "a b", "a&&b", "a|b", "~", "*"];
    // Run the quoted word through a POSIX-quote parser: one single-quoted run per segment, joined by \' escapes.
    const unquote = (w: string) => {
      if (/^[A-Za-z0-9._:@\/-]+$/.test(w)) return w;
      expect(w).toMatch(/^'(?:[^']|'\\'')*'$/s);
      return w.slice(1, -1).replace(/'\\''/g, "'");
    };
    for (const id of hostile) {
      const q = shellArg(id);
      expect(q.startsWith("'") && q.endsWith("'")).toBe(true);
      expect(unquote(q)).toBe(id);
    }
    expect(shellArg("plan.one")).toBe("plan.one");
    expect(shellArg("it's")).toBe("'it'\\''s'");
    const line = commandLines("claim", { id: "$(id)", systemId: "s;reboot" }, "x;rm -rf ~");
    expect(line).toBe(
      `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim '$(id)' 'x;rm -rf ~' --system 's;reboot' --dir './work/x;rm -rf ~'\n` +
      "( cd './work/x;rm -rf ~' && env -u ARTYFACT_ADMIN_TOKEN claude -p 'Follow AGENTS.md and TASK_PACKET.md, then run npx artyfact task submit' )",
    );
    // A newline inside an id stays inside its quotes: exactly the two intended lines start a command.
    const nl = commandLines("resume", { id: "p", systemId: "s" }, "a\nb");
    expect(nl).toContain("'a\nb'");
    expect(nl.split("\n").filter((l) => /^(ARTYFACT_ADMIN_TOKEN="\$ADMIN_TOKEN" npx|\( cd) /.test(l))).toHaveLength(2);
  });

  it("shows no runnable command for an id the CLI would refuse", () => {
    for (const bad of ["-x", "--platform=https://x", ".", "..", "x;rm -rf ~", "$(id)", "a b"]) expect(cliId(bad)).toBe(false);
    for (const ok of ["t1", "task.people", "a-b_c.d"]) expect(cliId(ok)).toBe(true);
    const p = makePlan({ tasks: [task("--platform=https://x")], analysis: { waves: [["--platform=https://x"]], conflicts: [] } });
    expect(taskCommand(p, p.tasks[0]!, NOW)).toEqual({ verb: null, reason: CLI_ID_REASON });
    const sys = makePlan({ systemId: "-s" });
    expect(taskCommand(sys, sys.tasks[0]!, NOW)).toEqual({ verb: null, reason: CLI_ID_REASON });
  });

  it("refuses a command when another task id differs only in case (one ./work directory on macOS)", () => {
    const p = makePlan({ tasks: [task("T1"), task("t1"), task("t2")], analysis: { waves: [["T1", "t1", "t2"]], conflicts: [] } });
    expect(taskCommand(p, p.tasks[0]!, NOW)).toEqual({ verb: null, reason: caseTwinReason("t1") });
    expect(taskCommand(p, p.tasks[1]!, NOW)).toEqual({ verb: null, reason: caseTwinReason("T1") });
    expect(taskCommand(p, p.tasks[2]!, NOW).verb).toBe("claim");
  });

  it("holds a ready task while a conflicting task has a live attempt", () => {
    const p = makePlan({
      tasks: [task("t1"), task("t2", { status: "working", attempts: [attempt({ taskId: "t2" })] })],
      analysis: { waves: [["t2"], ["t1"]], conflicts: [{ tasks: ["t1", "t2"], kind: "unknown", subjects: [], message: "" }] },
    });
    expect(taskCommand(p, p.tasks[0]!, NOW)).toEqual({ verb: null, reason: "Waits while “Task t2” is being worked; they conflict." });
  });

  it("explains waves and names the other task on conflicts", () => {
    const p = makePlan();
    expect(whyWave(p, "t1")).toBe("Wave 1: it waits on no other task and does not conflict with “Task t2”.");
    expect(whyWave(p, "t3")).toBe("Wave 2 because it depends on “Task t1” in wave 1; it edits files also in “Task t2” in wave 1 (on src/shared.ts).");
    expect(conflictsOf(p, "t3").map((c) => [c.kind, c.with])).toEqual([["dependency", "Task t1"], ["source", "Task t2"]]);
  });

  it("describes footprints, integration readiness and errors", () => {
    expect(footprintLine(task("t1"))).toBe("1 glob · 1 file");
    expect(footprintLine(task("t1", { footprint: { ...task("t1").footprint, known: false } }))).toBe("1 glob · 1 file · scope unknown");
    expect(integrateReason(makePlan())).toBe("Select a candidate for “Task t1”, “Task t2”, “Task t3” first.");
    expect(integrateReason(makePlan({ tasks: [task("t1", { selectedCandidate: "c" })] }))).toBeNull();
    expect(integrateReason(makePlan({ status: "integrated" }))).toBe("The plan is integrated.");
    expect(planError("Drafting", { status: 401 })).toMatch(/needs the admin token/);
    expect(planError("Drafting", { status: 409, code: "import-unreviewed", message: "import is unreviewed." })).toBe("import is unreviewed. Accept the import review first.");
  });

  it("counts work waiting from planCounts", () => {
    expect(workWaiting(undefined)).toBe(0);
    expect(workWaiting({ open: 2, awaitingAgent: 2, submitted: 1, integrated: 1 })).toBe(4);
  });
});
