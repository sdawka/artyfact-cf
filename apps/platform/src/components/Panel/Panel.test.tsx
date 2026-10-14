import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { Panel } from "./Panel";

function Host() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Describe a change</button>
    {open ? <Panel title="Describe a change" onBack={() => setOpen(false)} backLabel="Back to board" primary={<button>Send</button>}>form</Panel> : <p>board</p>}
  </>;
}

describe("Panel", () => {
  it("replaces the region: own h2 and primary, focus moves to the h2, Back returns focus to the opener", async () => {
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Describe a change" });
    opener.focus();
    fireEvent.click(opener);
    const h2 = screen.getByRole("heading", { level: 2, name: "Describe a change" });
    expect(document.activeElement).toBe(h2);
    expect(h2.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("region", { name: "Describe a change" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to board" }));
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(document.activeElement).toBe(opener);
    expect(screen.getByText("board")).toBeTruthy();
  });

  it("without onBack there is no back control; autoFocus can be turned off", () => {
    render(<Panel title="Details" autoFocus={false}>x</Panel>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
