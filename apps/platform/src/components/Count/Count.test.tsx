import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { Count } from "./Count";

describe("Count", () => {
  it("attention hides at zero; neutral shows 0", () => {
    const { container } = render(<><Count n={0} tone="attention" /><Count n={0} /></>);
    expect(container.textContent).toBe("0");
  });
  it("adds screen-reader words so a link reads 'Review, 2 waiting'", () => {
    render(<a href="/r">Review <Count n={2} tone="attention" srLabel="waiting" /></a>);
    const link = screen.getByRole("link");
    expect(link.textContent!.replace(/\s+/g, " ")).toBe("Review , 2 waiting");
    const count = link.querySelector("[data-tone]")!;
    expect(count.className).toContain("u-numeric");
    expect(count.getAttribute("data-tone")).toBe("attention");
  });
  it("null is the literal unknown", () => {
    render(<Count n={null} />);
    expect(screen.getByText("unknown")).toBeTruthy();
  });
});
