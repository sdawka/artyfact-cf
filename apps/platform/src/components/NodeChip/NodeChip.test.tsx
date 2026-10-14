import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { KindGlyphs, NodeChip } from "./NodeChip";

const glyphOf = (name: string) => screen.getByText(name).parentElement!.querySelector('[aria-hidden="true"]');

describe("NodeChip kind glyph", () => {
  it("shows the kind glyph by default, keeps the kind in the accessible text", () => {
    render(<NodeChip id="C.x" label="Saves goals" kind="criterion" interactive={false} />);
    expect(glyphOf("Saves goals")).toBeTruthy();
    expect(screen.getByText(/Saves goals/).parentElement!.textContent).toContain(", Criterion");
  });
  it("glyph={false} and <KindGlyphs hidden> hide it (verdict rows)", () => {
    render(<>
      <NodeChip id="C.a" label="A" kind="criterion" interactive={false} glyph={false} />
      <KindGlyphs hidden><NodeChip id="C.b" label="B" kind="criterion" interactive={false} /></KindGlyphs>
      <KindGlyphs hidden><NodeChip id="C.c" label="C" kind="criterion" interactive={false} glyph /></KindGlyphs>
    </>);
    expect(glyphOf("A")).toBeNull();
    expect(glyphOf("B")).toBeNull();
    expect(glyphOf("C")).toBeTruthy();
  });
});
