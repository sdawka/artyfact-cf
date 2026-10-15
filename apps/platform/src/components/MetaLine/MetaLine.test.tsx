import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { MetaLine } from "./MetaLine";

describe("MetaLine", () => {
  it("renders labelled facts as a dl without dot separators", () => {
    const { container } = render(<MetaLine items={[{ label: "started", value: "3 min ago", title: "2026-10-14T12:00:00Z" }, { label: "head", value: "sc-1-e12083f7", code: true }, { value: "unknown" }]} />);
    expect(container.querySelector("dl")).toBeTruthy();
    expect([...container.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["started", "head"]);
    expect(screen.getByText("sc-1-e12083f7").tagName).toBe("CODE");
    expect(screen.getByText("3 min ago").getAttribute("title")).toBe("2026-10-14T12:00:00Z");
    expect(container.textContent).not.toContain("·");
  });
});
