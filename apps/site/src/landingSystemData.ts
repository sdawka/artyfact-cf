export type CheckoutStep = { title: string; body: string; term?: string };

/** Illustrative online-store change, one entry per step of the lifecycle. */
export const checkoutSteps: CheckoutStep[] = [
  { title: 'Agree on the change', term: 'Evolution', body: 'A change request, “Add loyalty points”, is reviewed and accepted. The model already says the Place order step covers CheckoutButton.tsx and api/orders.ts. It also holds the rule “guests can still check out”.' },
  { title: 'Split it into Tasks', term: 'Realization · Task', body: 'The accepted model is pinned and split into two Tasks. Agent A changes CheckoutButton.tsx. Agent B changes api/orders.ts. They work at the same time, each in a private fork, and share no files.' },
  { title: 'Flag the overlap', body: 'Plain Git would merge two clean diffs. Artyfact sees that both change the Place order step and its rule “guests can still check out”, and flags the overlap.' },
  { title: 'Check against the rule', body: 'A’s change asks for a login before ordering, so the rule fails. B passes. A check that did not run would stay unknown, not green.' },
  { title: 'Integrate and promote', body: 'B is integrated and promoted. A is updated onto B and revises. If the System moved since that review, the promote is refused.' },
  { title: 'Deploy and observe', body: 'A person deploys the promoted commit. 42 sample order events land on it. That shows activity, not results. Did loyalty points bring customers back? Not measured yet.' },
  { title: 'Decide what is next', body: 'A person reads what happened and opens the next change request.' },
];
