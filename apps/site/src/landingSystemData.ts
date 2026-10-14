export type CheckoutStep = { title: string; body: string; term?: string };

/** Illustrative online-store change, one entry per step of the lifecycle. */
export const checkoutSteps: CheckoutStep[] = [
  { title: 'Agree on the change', term: 'Evolution', body: 'A change request, “Add loyalty points”, is reviewed and accepted. The model already says the Place order step covers CheckoutButton.tsx and api/orders.ts. It also holds the rule “guests can still check out”.' },
  { title: 'Plan the Tasks', term: 'Realization · Task', body: 'The accepted model is pinned and split into three Tasks. A changes CheckoutButton.tsx. B changes api/orders.ts. C adds a points email. A and B touch different files, but both change Place order.' },
  { title: 'Run them in order', body: 'Planning puts A and B in sequence because they change the same step. C runs beside A. Each agent works in its own private fork. Plain Git would run A and B side by side and merge two clean diffs.' },
  { title: 'Check against the rule', body: 'A’s change asks for a login before ordering, so “guests can still check out” fails. A revises in its fork, then B runs. A check that did not run would stay unknown, not green.' },
  { title: 'Integrate and promote', body: 'The selected results of A, B and C are integrated into one review. The combined result is checked and promoted. If the System moved since that review, the promote is refused.' },
  { title: 'Deploy and observe', body: 'A person deploys the promoted commit. 42 sample order events land on it. That shows activity, not results. Did loyalty points bring customers back? Not measured yet.' },
  { title: 'Decide what is next', body: 'A person reads what happened and opens the next change request.' },
];
