import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

describe("Overview", () => {
  it("shows P1, three captioned meters and literal unknown for outcome progress", async () => {
    renderApp("/s/system.keep-in-touch/r/head/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(screen.getByText(/Help an individual keep in touch/)).toBeTruthy();
    const readiness = screen.getByRole("region", { name: "Model readiness" });
    const conformance = screen.getByRole("region", { name: "Implementation conformance" });
    const outcome = screen.getByRole("region", { name: "Outcome progress" });
    expect(within(outcome).getByText("unknown", { selector: "p" })).toBeTruthy();
    expect(within(readiness).getByText("actionable")).toBeTruthy();
    expect(within(conformance).getByText("not run", { selector: "p" })).toBeTruthy();
    const captions = [readiness, conformance, outcome].map((r) => r.querySelectorAll("p")[r.querySelectorAll("p").length - 2]!.textContent);
    expect(new Set(captions).size).toBe(3);
    expect(screen.getByText(/Is the Purpose being achieved/)).toBeTruthy();
  });

  it("lists kit.unpinned with an expandable derivation", async () => {
    renderApp("/s/system.keep-in-touch/r/head/overview");
    const row = (await screen.findByText("kit.unpinned")).closest("li")!;
    expect(within(row).getByText("Pin the kit in kits.yaml.")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /Explain/ }));
    await waitFor(() => expect(within(row).getByLabelText(/^Derivation of/)).toBeTruthy());
    expect(within(row).getByText(/kitRequired/)).toBeTruthy();
  });

  it("shows evolutions by state with links to Work and an undeployed card", async () => {
    renderApp("/s/system.keep-in-touch/r/head/overview");
    const link = await screen.findByRole("link", { name: "Private contact foundation" });
    expect(link.getAttribute("href")).toContain("/work?");
    expect(link.getAttribute("href")).toContain("evolution=evolution.1");
    expect(screen.getByText(/not deployed/)).toBeTruthy();
  });
});
