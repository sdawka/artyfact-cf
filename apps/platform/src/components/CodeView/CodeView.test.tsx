import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/testing/render";
import { editorText, typeInEditor } from "@/testing/codemirror";
import CodeView from "./CodeView";
import { languageFor } from "./languages";

describe("CodeView", () => {
  it("shows yaml read-only with aria-readonly", () => {
    const { container } = render(<CodeView value={"id: system.x\nname: X\n"} path="system.yaml" label="system.yaml" readOnly />);
    expect(editorText(container)).toBe("id: system.x\nname: X\n");
    const content = container.querySelector(".cm-content")!;
    expect(content.getAttribute("aria-readonly")).toBe("true");
    expect(content.getAttribute("contenteditable")).toBe("false");
    expect(content.getAttribute("aria-label")).toBe("system.yaml");
    expect(() => typeInEditor(container, "x")).toThrow(/read-only/);
  });

  it("calls onChange with the new text when editable", () => {
    const onChange = vi.fn();
    const { container } = render(<CodeView value="a: 1" path="x.yaml" label="x" onChange={onChange} />);
    expect(container.querySelector(".cm-content")!.getAttribute("aria-readonly")).toBe("false");
    typeInEditor(container, "\nb: 2");
    expect(onChange).toHaveBeenLastCalledWith("a: 1\nb: 2");
  });

  it("switches read-only off when the prop changes", () => {
    const { container, rerender } = render(<CodeView value="a" path="x.md" label="x" readOnly />);
    rerender(<CodeView value="a" path="x.md" label="x" readOnly={false} />);
    expect(container.querySelector(".cm-content")!.getAttribute("aria-readonly")).toBe("false");
  });

  it("picks languages by extension", () => {
    for (const p of ["a.yaml", "a.yml", "a.js", "a.ts", "a.tsx", "a.json", "a.md"]) expect(languageFor(p), p).not.toBeNull();
    expect(languageFor("a.txt")).toBeNull();
  });
});
