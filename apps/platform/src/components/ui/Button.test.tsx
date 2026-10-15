import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { Button } from "./Controls";

describe("Button reason", () => {
  it("a reason disables the button and is its visible, linked description", () => {
    render(<Button variant="primary" reason="Set the admin token in the header.">Create System</Button>);
    const b = screen.getByRole("button", { name: "Create System" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("data-variant")).toBe("primary");
    const reason = document.getElementById(b.getAttribute("aria-describedby")!)!;
    expect(reason.textContent).toBe("Set the admin token in the header.");
    expect(screen.getByText("Set the admin token in the header.")).toBe(reason);
  });
  it("no reason: plain enabled button, existing aria-describedby kept", () => {
    render(<><p id="h">hint</p><Button aria-describedby="h" reason={undefined}>Go</Button></>);
    const b = screen.getByRole("button", { name: "Go" }) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(b.getAttribute("aria-describedby")).toBe("h");
    expect(b.parentElement!.hasAttribute("data-reason")).toBe(false);
  });
});
