import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

describe("Overview", () => {
  it("shows P1, three captioned meters and literal unknown for outcome progress", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    expect(await screen.findByRole("heading", { level: 1, name: "Peopling" })).toBeTruthy();
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

  it("labels each meter with its layer's question, the same words as the rail", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    for (const [meter, question] of [
      ["Model readiness", "What should it be"], ["Implementation conformance", "What is being made"], ["Outcome progress", "What does it do"],
    ]) {
      const region = screen.getByRole("region", { name: meter });
      expect(within(region).getByText(question!).getAttribute("data-question")).toBe("");
    }
    expect(screen.getByText("Reported side by side. No combined score exists.")).toBeTruthy();
  });

  it("links each meter title to its layer's view and leaves the meters out of the tab order", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    for (const [meter, view] of [["Model readiness", "/map"], ["Implementation conformance", "/evaluations"], ["Outcome progress", "/phenome"]]) {
      const region = screen.getByRole("region", { name: meter });
      expect(region.getAttribute("tabindex")).toBeNull();
      expect(within(region).getByRole("link", { name: meter }).getAttribute("href")).toContain(view);
    }
  });

  it("offers Describe a change as the one primary action, into Work's intent panel", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const link = await screen.findByRole("link", { name: "Describe a change" });
    expect(link.getAttribute("href")).toContain("/work?");
    expect(link.getAttribute("href")).toContain("panel=intent");
  });

  it("hides Needs you when nothing waits, and lists only active Evolutions", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
    const active = screen.getByRole("region", { name: /Active Evolutions/ });
    expect(within(active).getAllByRole("link").length).toBeGreaterThan(1);
    expect(within(active).queryByText(/promoted|rejected|withdrawn/)).toBeNull();
  });

  it("leads with the System name and Purpose in the header and one light with labelled values", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    expect(screen.getAllByText(/Help an individual keep in touch/)).toHaveLength(1);
    const hero = screen.getByRole("region", { name: "System light" });
    expect(hero.querySelector('[data-effect="orb"]')).toBeNull();
    expect(hero.querySelector('[data-effect="surface"]')).toBeTruthy();
    expect(within(hero).getByText("The light reflects readiness, checks, active work and blockers.")).toBeTruthy();
    for (const label of ["Readiness", "Failing or stale checks", "Active work", "Blockers"]) expect(within(hero).getByText(label)).toBeTruthy();
  });

  it("lists Peopling's provisional nodes apart from its blockers (none)", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const card = await screen.findByRole("region", { name: "Blockers and warnings" });
    expect(within(card).getByText("Nothing blocks this System.")).toBeTruthy();
    expect(within(card).getAllByText(/node\.provisional/).length).toBeGreaterThan(0);
  });

  it("does not paint a zero pass count in the success tone", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const conformance = await screen.findByRole("region", { name: "Implementation conformance" });
    const pass = within(conformance).getByText("pass", { selector: "li > span" }).closest("li")!;
    expect(pass.textContent).toContain("0");
    expect(pass.getAttribute("data-tone")).not.toBe("pass");
    expect(conformance.querySelector('[data-tone="pass"]')).toBeNull();
  });

  it("lists kit.unpinned with an expandable derivation", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const row = (await screen.findByText("kit.unpinned")).closest("li")!;
    expect(within(row).getByText("Pin the kit under kits in the root node.yaml.")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /kit\.unpinned/ }));
    fireEvent.click(within(row).getByRole("button", { name: /Show derivation/ }));
    await waitFor(() => expect(within(row).getByLabelText(/^Derivation of/)).toBeTruthy());
    expect(within(row).getByText(/kitRequired/)).toBeTruthy();
  });

  it("shows evolutions by state with links to Work and an undeployed card", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const link = await screen.findByRole("link", { name: /Private contact foundation/ });
    expect(link.getAttribute("href")).toContain("/work?");
    expect(link.getAttribute("href")).toContain("evolution=evolution.1");
    expect(screen.getByText("not deployed")).toBeTruthy();
  });
});

describe("Overview hero and facts (design critique S5, S18)", () => {
  it("holds the System h1, Purpose and primary inside the one light, with the readings on a band below it", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const h1 = await screen.findByRole("heading", { level: 1, name: "Peopling" });
    const hero = screen.getByRole("region", { name: "System light" });
    expect(hero.contains(h1)).toBe(true);
    const field = hero.querySelector('[data-effect="surface"]')!.parentElement!;
    expect(field.contains(h1)).toBe(true);
    expect(within(hero).getByRole("link", { name: "Describe a change" })).toBeTruthy();
    // The labelled values sit outside the field, never over the haze.
    const lead = within(hero).getByText("The light reflects readiness, checks, active work and blockers.");
    expect(field.contains(lead)).toBe(false);
  });

  it("reads Facts' head from the same source as the TopBar when the model has none", async () => {
    renderApp("/s/system.peopling/r/head/overview", undefined, (qc) =>
      qc.setQueryData(qk.revisions("system.peopling"), {
        revisions: [{ id: "head", kind: "head", label: "head (sc-1)" }, { id: "sc-1-e12083f7", kind: "commit", label: "sc-1 Import" }],
      }));
    const facts = await screen.findByRole("region", { name: "Facts" });
    const head = within(facts).getByText("Head").nextElementSibling!;
    expect(head.textContent).toBe("sc-1-e12083f7");
  });
});
