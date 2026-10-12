import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { UiVerdict } from "@/model/status";
import { VerdictBadge } from "./VerdictBadge";

describe("VerdictBadge", () => {
  it.each<[UiVerdict, string]>([
    ["pass", "pass"],
    ["fail", "fail"],
    ["unknown", "subtle"],
    ["stale", "subtle"],
    ["not-run", "subtle"],
    ["waived", "subtle"],
  ])("%s renders the %s tone with glyph and word", (verdict, tone) => {
    render(<VerdictBadge verdict={verdict} />);
    const el = screen.getByText(verdict).closest("[data-verdict]")!;
    expect(el.getAttribute("data-verdict")).toBe(verdict);
    expect(el.getAttribute("data-tone")).toBe(tone);
    expect(el.className).toContain("u-verdict");
    expect(el.querySelector("[aria-hidden]")?.textContent).not.toBe("");
  });
});
