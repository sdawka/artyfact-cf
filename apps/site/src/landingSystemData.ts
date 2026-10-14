export type CheckoutStep = { title: string; body: string; term?: string };

/** Illustrative online-store change, one entry per step of the lifecycle. */
export const checkoutSteps: CheckoutStep[] = [
  { title: 'Agree on the change', term: 'Evolution', body: 'A change request, “Add loyalty points”, is reviewed and accepted. The model already says the Place order step covers CheckoutButton.tsx and api/orders.ts, with the rule “guests can still check out”.' },
  { title: 'Split it into Tasks', term: 'Realization · Task', body: 'The accepted model is pinned and split into two Tasks. Agent A and Agent B each work in a private fork. They share no files.' },
  { title: 'Flag the overlap', body: 'Both Tasks change Place order. Plain Git sees two clean diffs. Artyfact flags the overlap, so the two are coordinated instead of merged blind.' },
  { title: 'Check against the rule', body: 'A’s change asks for a login before ordering, so “guests can still check out” fails. B passes. A check that did not run would stay unknown, not green.' },
  { title: 'Integrate and promote', body: 'B’s result is selected and integrated. A goes back to revise. The combined result is reviewed and promoted. If the System moved since that review, the promote is refused.' },
  { title: 'Deploy and observe', body: 'B deploys. Sample order events attach to the deployed commit. Outcome: not measured yet.' },
  { title: 'Decide what is next', body: 'A person reads what happened and opens the next change request.' },
];
