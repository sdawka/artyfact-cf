import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/testing/render";
import { Derivation, derivationText, type DerivationTree } from "./Derivation";

const tree: DerivationTree = {
  relation: "violation",
  tuple: ["coverage.hook", "C.a"],
  rule: "readiness@1:10",
  edb: false,
  alternatives: 2,
  children: [
    {
      relation: "governedBy",
      tuple: ["op.save", "policy.owner"],
      rule: "readiness@1:4",
      edb: false,
      children: [{ relation: "governs", tuple: ["policy.owner", "op.save"], edb: true, children: [] }],
    },
    { relation: "criterion", tuple: ["C.a"], edb: true, children: [] },
  ],
};

describe("Derivation", () => {
  it("renders a 3-level tree with rule ids and EDB facts", () => {
    render(<Derivation derivation={tree} />);
    expect(screen.getByText("violation")).toBeTruthy();
    expect(screen.getByText("readiness@1:10")).toBeTruthy();
    expect(screen.getByText("governs")).toBeTruthy();
    expect(screen.getAllByText("fact").length).toBe(2);
    expect(screen.getByText(/2 derivations/)).toBeTruthy();
  });

  it("collapses a branch", () => {
    render(<Derivation derivation={tree} />);
    const branch = screen.getByRole("button", { name: /governedBy/ });
    expect(branch.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(branch);
    expect(branch.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("governs")).toBeNull();
  });

  it("accepts a finding and stops at depth 6 with an ellipsis", () => {
    let t: DerivationTree = { relation: "leaf", tuple: [], edb: true, children: [] };
    for (let i = 0; i < 8; i++) t = { relation: `r${i}`, tuple: [], rule: "p:1", edb: false, children: [t] };
    const finding = { level: "error" as const, rule: "x", message: "m", facts: [], derivation: t };
    render(<Derivation finding={finding} />);
    expect(screen.getByText("r1")).toBeTruthy();
    expect(screen.queryByText("r0")).toBeNull();
    expect(screen.getByText("…")).toBeTruthy();
  });

  it("renders id arguments as chips when the argument is not a model id as plain text", () => {
    render(<Derivation derivation={tree} />);
    // Outside a model provider ids are text, not buttons.
    expect(within(screen.getAllByLabelText(/^Derivation of/)[0]!).getAllByText("C.a").length).toBeGreaterThan(0);
  });

  it("copies an indented text outline", async () => {
    const writeText = vi.fn(async (_t: string) => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<Derivation derivation={tree} />);
    act(() => screen.getByRole("button", { name: "Copy derivation as text" }).click());
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toBe(derivationText(tree));
    expect(derivationText(tree).split("\n")).toEqual([
      "violation(coverage.hook, C.a)  [rule readiness@1:10]",
      "  governedBy(op.save, policy.owner)  [rule readiness@1:4]",
      "    governs(policy.owner, op.save)  [fact]",
      "  criterion(C.a)  [fact]",
    ]);
  });
});
