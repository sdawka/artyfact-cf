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

  it("leads with a hero: the System name, its Purpose once, a decorative orb and a caption saying what drives it", async () => {
    renderApp("/s/system.keep-in-touch/r/head/overview");
    const hero = await screen.findByRole("region", { name: "Keep in Touch" });
    expect(within(hero).getByText(/Help an individual keep in touch/)).toBeTruthy();
    expect(screen.getAllByText(/Help an individual keep in touch/)).toHaveLength(1);
    expect(hero.querySelector('[data-effect="orb"]')!.closest('[aria-hidden="true"]')).toBeTruthy();
    const caption = within(hero).getByText(/^Fill: readiness \d+%/);
    expect(caption.textContent).toMatch(/Crackle: \d+ failing or stale checks? · Strands: \d+ active Evolutions? · Flares: \d+ blockers? · Colour: (passing|failing|blocked|pending)/);
    // The meters live in the hero and take keyboard focus (the orb sparks toward the focused one).
    expect(within(hero).getByRole("region", { name: "Model readiness" }).tabIndex).toBe(0);
  });

  it("does not paint a zero pass count in the success tone", async () => {
    renderApp("/s/system.keep-in-touch/r/head/overview");
    const conformance = await screen.findByRole("region", { name: "Implementation conformance" });
    const pass = within(conformance).getByText("pass", { selector: "li > span" }).closest("li")!;
    expect(pass.textContent).toContain("0");
    expect(pass.getAttribute("data-tone")).not.toBe("pass");
    expect(conformance.querySelector('[data-tone="pass"]')).toBeNull();
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
