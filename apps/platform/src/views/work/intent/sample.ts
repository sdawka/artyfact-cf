import type { Proposal } from "../../../../shared/api";

/**
 * Shown read-only in fixture mode so the panel has something to review without the API. Ids are from the
 * Keep in Touch fixture; `component.BirthdayField` is what an `add` would mint.
 */
export const SAMPLE_PROPOSAL: Proposal = {
  id: "proposal.sample",
  systemId: "system.keep-in-touch",
  message: "Let people record a birthday on a contact and show it in the People list.",
  anchor: "screen.people",
  status: "open",
  route: [
    { level: "shortlist", choice: "screen.people", confidence: 0.82 },
    { level: "intent", choice: "add", confidence: 0.71 },
    { level: "kind", choice: "component", confidence: 0.64 },
  ],
  ops: [
    {
      id: "op.1",
      op: "update",
      node: "screen.people",
      fields: {
        description:
          "Exactly PageHeading, SearchInput, AddContact control and ContactCollection. One ContactRow per result; each row has a name, the birthday when known, and Open control.",
      },
    },
    {
      id: "op.2",
      op: "add",
      node: "component.BirthdayField",
      kind: "component",
      parent: "component.ContactCollection",
      fields: { title: "Birthday field", description: "Optional day and month on a contact; never the year." },
      criteria: [{ id: "C.people.birthday", claim: "A contact with a birthday shows it in its row; one without shows nothing." }],
    },
    { id: "op.3", op: "link", node: "component.BirthdayField", link: { rel: "references", to: "screen.people" }, dependsOn: ["op.2"] },
  ],
  questions: [{ id: "q.1", text: "Should the Today screen also suggest people whose birthday is close?" }],
  problems: [{ opId: "op.3", severity: "warning", message: "The template does not declare the relation references." }],
  provenance: {
    router: { provider: "fake", model: "fake", calls: 3 },
    translator: { provider: "fake", model: "fake" },
    genomeCommit: "unknown",
    fake: true,
  },
  createdAt: "2026-10-13T00:00:00.000Z",
};
