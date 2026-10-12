import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildTone, StatusChip } from "./StatusChip";

describe("StatusChip", () => {
  it("renders glyph and label with status and tone", () => {
    render(<StatusChip status="failed" label="build failed" tone="fail" glyph="×" title="t" />);
    const chip = screen.getByText("build failed");
    expect(chip.getAttribute("data-status")).toBe("failed");
    expect(chip.getAttribute("data-tone")).toBe("fail");
    expect(chip.querySelector('[aria-hidden="true"]')!.textContent).toBe("×");
  });

  it("allows the pass tone only for a passed build (or assay pass)", () => {
    render(<><StatusChip status="passed" tone="pass" /><StatusChip status="live" tone="pass" /></>);
    expect(screen.getByText("passed").getAttribute("data-tone")).toBe("pass");
    expect(screen.getByText("live").getAttribute("data-tone")).toBe("neutral");
    expect([buildTone("passed"), buildTone("error"), buildTone(undefined)]).toEqual(["pass", "fail", "neutral"]);
  });
});
