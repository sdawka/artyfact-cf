import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";
import { finding } from "@/views/work/panels/amendment/testData";
import { FindingBody } from "./FindingBody";

describe("FindingBody", () => {
  it("shows rule id, message, level, subject chip and derivation", async () => {
    renderApp("/s/system.keep-in-touch/r/head/overview", [
      { path: "/s/:systemId/r/:rev/overview", element: <FindingBody finding={finding("error", "rule.x", "section.purpose", "Something is off")} /> },
    ]);
    expect((await screen.findAllByText("rule.x")).length).toBeGreaterThan(0);
    expect(screen.getByText("Something is off")).toBeTruthy();
    expect(screen.getByText("error")).toBeTruthy();
    expect(screen.getByRole("tree", { name: /Derivation of violation/ })).toBeTruthy();
  });
});
