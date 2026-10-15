import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { StatusText } from "./StatusText";

describe("StatusText", () => {
  it("glyph + word, glyph hidden, tone set, default glyph per tone", () => {
    render(<StatusText status="awaiting" label="2 await review" tone="attention" />);
    const el = screen.getByText("2 await review");
    expect(el.getAttribute("data-tone")).toBe("attention");
    const g = el.querySelector('[aria-hidden="true"]')!;
    expect(g.textContent).toBe("◔");
    expect(g.className).toContain("u-glyph");
  });
  it("pass tone only for pass/passed; empty glyph renders none", () => {
    render(<><StatusText status="passed" tone="pass" /><StatusText status="live" tone="pass" glyph="" /></>);
    expect(screen.getByText("passed").getAttribute("data-tone")).toBe("pass");
    const live = screen.getByText("live");
    expect(live.getAttribute("data-tone")).toBe("neutral");
    expect(live.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
