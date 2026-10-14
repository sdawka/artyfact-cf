import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shortRev } from "@/model/revisions";
import { RevisionPicker } from "./RevisionPicker";

HTMLElement.prototype.scrollIntoView ??= function () {};
afterEach(cleanup);

describe("RevisionPicker", () => {
  it("groups head, commits and candidates and reports changes", async () => {
    const onChange = vi.fn();
    render(
      <RevisionPicker id="from" label="From" value="sc-1" onChange={onChange} options={[
        { id: "cand.1", kind: "candidate", label: "cand.1" },
        { id: "head", kind: "head", label: "head" },
        { id: "sc-1", kind: "commit", label: "sc-1 · Import" },
      ]} />,
    );
    const select = screen.getByRole("combobox", { name: "From" });
    expect(select.textContent).toContain("sc-1 · Import");
    fireEvent.keyDown(select, {key: "ArrowDown"});
    await screen.findByRole("listbox");
    expect(screen.getAllByRole("group").map(g => g.textContent)).toEqual(["Headhead", "System commitssc-1 · Import", "Candidatescand.1"]);
    const candidate = screen.getByRole("option", {name:"cand.1"});
    candidate.focus(); fireEvent.keyDown(candidate, {key:"Enter"});
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(onChange).toHaveBeenCalledWith("cand.1");
  });

  it("keeps an unlisted value selectable", async () => {
    const sha = "a".repeat(40);
    render(<RevisionPicker id="to" label="To" value={sha} onChange={() => {}} options={[{ id: "head", kind: "head", label: "head" }]} />);
    const trigger = screen.getByRole("combobox", {name:"To"});
    expect(trigger.textContent).toContain(shortRev(sha));
    fireEvent.keyDown(trigger, {key:"ArrowDown"});
    await screen.findByRole("listbox");
    expect(screen.getByRole("option", { name: shortRev(sha) })).toBeTruthy();
    expect([shortRev("head"), shortRev(null), shortRev(sha)]).toEqual(["head", "unknown", "aaaaaaa"]);
  });
});
