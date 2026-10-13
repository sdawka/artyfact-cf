import { expect, it } from "vitest";
import { outcomesTemplate, validateOutcomeEvent } from "../src/outcomes";
import { loadTemplate } from "../src/meta/template";
import { checkTemplateForm } from "../src/meta/form";
import { ARTYFACT_GENOME } from "../src/adapters/artyfact/graph";
import { artyfactGenome } from "../src/adapters/artyfact/template";
it("keeps outcomes selectable and validates exact versioned event payloads", () => {
  expect(artyfactGenome.kinds).not.toHaveProperty("eventContract");
  expect(outcomesTemplate.kinds).toHaveProperty("eventContract");
  const store = { get: (ref: string) => ref === ARTYFACT_GENOME ? artyfactGenome : undefined };
  expect(checkTemplateForm(loadTemplate(outcomesTemplate, store), store).valid).toBe(true);
  const contracts = [{ id: "event.saved", version: 2, fields: [{ name: "count", type: "number" as const, required: true }] }];
  expect(validateOutcomeEvent(contracts, { contractId: "event.saved", version: 2, payload: { count: 3 } })).toEqual({ valid: true, issues: [] });
  expect(validateOutcomeEvent(contracts, { contractId: "event.saved", version: 1, payload: { count: 3 } }).valid).toBe(false);
  expect(validateOutcomeEvent(contracts, { contractId: "event.saved", version: 2, payload: { count: "3" } }).valid).toBe(false);
  expect(validateOutcomeEvent([], { contractId: "event.saved", version: 2, payload: {} }).valid).toBe(false);
});
