import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { shortRev } from "@/model/revisions";
import { RevisionPicker } from "./RevisionPicker";

describe("RevisionPicker", () => {
  it("groups head, commits and candidates and reports changes", () => {
    const onChange = vi.fn();
    render(
      <RevisionPicker id="from" label="From" value="sc-1" onChange={onChange} options={[
        { id: "cand.1", kind: "candidate", label: "cand.1" },
        { id: "head", kind: "head", label: "head" },
        { id: "sc-1", kind: "commit", label: "sc-1 · Import" },
      ]} />,
    );
    const select = screen.getByLabelText("From") as HTMLSelectElement;
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Head", "System commits", "Candidates"]);
    expect(select.value).toBe("sc-1");
    fireEvent.change(select, { target: { value: "cand.1" } });
    expect(onChange).toHaveBeenCalledWith("cand.1");
  });

  it("keeps an unlisted value selectable", () => {
    const sha = "a".repeat(40);
    render(<RevisionPicker id="to" label="To" value={sha} onChange={() => {}} options={[{ id: "head", kind: "head", label: "head" }]} />);
    expect((screen.getByLabelText("To") as HTMLSelectElement).value).toBe(sha);
    expect(screen.getByRole("option", { name: shortRev(sha) })).toBeTruthy();
    expect([shortRev("head"), shortRev(null), shortRev(sha)]).toEqual(["head", "unknown", "aaaaaaa"]);
  });
});
