import type { Task, TaskPlan } from "../../../../shared/api";

const EVO = "evolution.1";
const task = (id: string, title: string, intent: string, nodes: string[], globs: string[], paths: string[], entry: string[], criteria: string[], dependsOn: string[] = []): Task => ({
  id,
  evolutionId: EVO,
  title,
  intent,
  thing: "thing.webapp",
  nodes,
  footprint: { globs, paths, unmatched: [], entryFiles: entry.map((path) => ({ path, certainty: "declared" as const })) },
  acceptanceCriteria: criteria,
  dependsOn,
  status: "planned",
  origin: "fallback",
});

/**
 * Shown read-only in fixture mode so the Plan panel has something to show without the API. Ids and file bindings are from
 * the Peopling fixture's `evolution.1`; the waves follow the planner's rule (declared dependencies and shared files).
 */
export const SAMPLE_PLAN: TaskPlan = {
  version: 1,
  evolutionId: EVO,
  genomeCommit: "0000000",
  appCommit: null,
  tasks: [
    task("task.1", "Contact storage", "Store contacts per owner.", ["entity.ContactRecord"], ["src/worker/routes/contacts.ts"], ["src/worker/routes/contacts.ts"], ["src/worker/routes/contacts.ts"], ["C.webapp.contact.storage"]),
    task("task.2", "People screen", "Show the People screen exactly as specified.", ["screen.people", "section.ui"], ["public/people/**"], ["public/people/index.html", "public/people/people.js", "public/people/people.css"], ["public/people/index.html"], ["C.webapp.screen.people", "C.webapp.screen.exact"]),
    task("task.3", "Owner-only access", "Only the owner reads and writes their contacts.", ["policy.ownerOnly"], ["src/worker/auth.ts", "src/worker/routes/contacts.ts"], ["src/worker/auth.ts", "src/worker/routes/contacts.ts"], ["src/worker/auth.ts"], ["C.webapp.private.owner"]),
    task("task.4", "Save a contact", "The Add contact dialog saves a contact.", ["affordance.AddContactDialog.save"], ["public/people/add-contact-dialog.js"], ["public/people/add-contact-dialog.js"], [], ["C.webapp.contact.save"], ["task.1"]),
  ],
  conflicts: [
    { kind: "file", tasks: ["task.1", "task.3"], subjects: ["src/worker/routes/contacts.ts"], message: "Both edit src/worker/routes/contacts.ts." },
    { kind: "declared", tasks: ["task.4", "task.1"], subjects: [], message: "Save a contact depends on Contact storage." },
    { kind: "file", tasks: ["task.2", "task.4"], subjects: ["public/people/add-contact-dialog.js"], message: "public/people/** covers public/people/add-contact-dialog.js." },
  ],
  waves: [["task.1", "task.2"], ["task.3", "task.4"]],
  problems: [],
  provenance: { planner: { provider: "fixture", model: "none" }, fake: true },
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
};
