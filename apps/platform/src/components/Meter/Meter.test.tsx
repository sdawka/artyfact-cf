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
  });
  it("shows the empty text instead of a legend when nothing is counted", () => {
    render(<Meter title="T" headline="unknown" caption="c" segments={[{ key: "a", label: "a", count: 0, tone: "subtle" }]} emptyText="nothing yet" />);
    expect(screen.getByText("nothing yet")).toBeTruthy();
  });
});
