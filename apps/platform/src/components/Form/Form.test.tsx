import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { Check, Field, Form, FormActions, Reason } from "./Form";
import { Facts } from "../Facts/Facts";
import { CommandBlock } from "../CommandBlock/CommandBlock";

describe("Form primitives", () => {
  it("labels controls, groups actions and states reasons", () => {
    render(<Form aria-label="New"><Field label="Title"><input /></Field><Check><input type="checkbox" />Include</Check><FormActions><button>Create</button></FormActions><Reason tone="error">Could not create.</Reason></Form>);
    expect(screen.getByRole("form", { name: "New" })).toBeTruthy();
    expect(screen.getByLabelText("Title").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Include").getAttribute("type")).toBe("checkbox");
    expect(screen.getByText("Could not create.").tagName).toBe("P");
  });
  it("Facts renders term/value pairs; CommandBlock one line per command with Copy", () => {
    const { container } = render(<><Facts items={[{ term: "Phase", value: "build" }]} /><CommandBlock title="Run" commands={["npx artyfact claim", "npx artyfact start"]} /></>);
    expect(container.querySelector("dt")!.textContent).toBe("Phase");
    expect(container.querySelectorAll("pre").length).toBe(2);
    expect(screen.getByRole("heading", { level: 3, name: "Run" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy/ })).toBeTruthy();
  });
});
