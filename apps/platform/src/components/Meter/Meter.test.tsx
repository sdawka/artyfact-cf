import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { Meter } from "./Meter";

describe("Meter", () => {
  it("lists every segment with its count and the caption", () => {
    render(
      <Meter
        title="T"
        headline="1 of 3 pass"
        caption="Not a promise."
        segments={[
          { key: "p", label: "pass", count: 1, tone: "pass" },
          { key: "f", label: "fail", count: 0, tone: "fail" },
          { key: "n", label: "not run", count: 2, tone: "subtle" },
        ]}
      />,
    );
    expect(screen.getByRole("region", { name: "T" })).toBeTruthy();
    expect(screen.getByText("Not a promise.")).toBeTruthy();
    expect(screen.getByText("not run").nextSibling?.textContent).toBe("2");
    expect(screen.getByText("fail").nextSibling?.textContent).toBe("0");
    expect(screen.getByRole("region", { name: "T" }).querySelector('span[data-tone="pass"]')?.getAttribute("title")).toBe("pass: 1");
  });
  it("shows the question under the title when given", () => {
    render(<Meter title="T" question="What should it be" headline="unknown" caption="c" segments={[]} />);
    expect(screen.getByText("What should it be").previousElementSibling?.textContent).toBe("T");
  });
  it("shows the empty text instead of a legend when nothing is counted", () => {
    render(<Meter title="T" headline="unknown" caption="c" segments={[{ key: "a", label: "a", count: 0, tone: "subtle" }]} emptyText="nothing yet" />);
    expect(screen.getByText("nothing yet")).toBeTruthy();
  });
  it("gives a zero pass count the neutral tone and a non-zero one the pass tone", () => {
    const { container, rerender } = render(
      <Meter title="T" headline="h" caption="c" segments={[
        { key: "p", label: "pass", count: 0, tone: "pass" },
        { key: "n", label: "not run", count: 2, tone: "subtle" },
      ]} />,
    );
    expect(container.querySelector('[data-tone="pass"]')).toBeNull();
    rerender(
      <Meter title="T" headline="h" caption="c" segments={[
        { key: "p", label: "pass", count: 1, tone: "pass" },
        { key: "n", label: "not run", count: 2, tone: "subtle" },
      ]} />,
    );
    expect(container.querySelector('[data-tone="pass"]')).not.toBeNull();
  });
  it("gives unknown and not-run segments and the unknown headline no pass tone", () => {
    const { container } = render(
      <Meter
        title="T"
        headline="unknown"
        caption="c"
        segments={[
          { key: "u", label: "unknown", count: 2, tone: "subtle" },
          { key: "n", label: "not run", count: 3, tone: "subtle" },
        ]}
      />,
    );
    expect(container.querySelector('[data-tone="pass"]')).toBeNull();
    expect(container.querySelectorAll('[data-tone="subtle"]').length).toBeGreaterThan(0);
    expect(screen.getByText("unknown", { selector: "p" }).getAttribute("data-unknown")).not.toBeNull();
  });
});
