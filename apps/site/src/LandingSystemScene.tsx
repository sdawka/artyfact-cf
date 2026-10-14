import React from 'react';

type Phase = 'done' | 'current' | 'next';
const phase = (from: number, step: number): Phase => from < step ? 'done' : from === step ? 'current' : 'next';

/** The board for one step. All text is prerendered; later rows become placeholders once enhanced. */
export function CheckoutScene({ step }: { step: number }) {
  const at = (from: number) => ({ 'data-phase': phase(from, step) });
  return <figure className="checkout-scene" aria-label="Illustrative board for the online store example">
    <figcaption className="checkout-scene-caption"><strong>Online store</strong><span>Sample data</span></figcaption>
    <div className="checkout-row checkout-request" {...at(0)}><span className="checkout-kind">Change request</span><strong>Add loyalty points</strong><span className="checkout-chip">Accepted</span></div>
    <div className="checkout-row checkout-subject" {...at(0)}><span className="checkout-kind">Step in the model</span><strong>Place order</strong>
      <span className="checkout-files"><code>CheckoutButton.tsx</code><code>api/orders.ts</code></span>
      <span className="checkout-rule">Rule: guests can still check out</span></div>
    <div className="checkout-lanes">
      {([['A', 'CheckoutButton.tsx', 'Fail: requires login', 'fail'], ['B', 'api/orders.ts', 'Pass', 'pass']] as const).map(([agent, file, verdict, kind]) => <div key={agent} className="checkout-row checkout-lane" {...at(1)}>
        <span className="checkout-kind">Agent {agent} · private fork</span><code>{file}</code>
        <span className="checkout-verdict" data-verdict={kind} {...at(3)}>{verdict}</span>
      </div>)}
    </div>
    <div className="checkout-row checkout-overlap" {...at(2)}><span className="checkout-kind">Overlap</span><strong>Both Tasks change Place order</strong></div>
    <div className="checkout-row checkout-promote" {...at(4)}><span className="checkout-kind">Promote</span><strong>B integrated and promoted</strong><span>A revising</span></div>
    <div className="checkout-row checkout-deploy" {...at(5)}><span className="checkout-kind">Deployed</span><code>3f9c2a1</code><span>42 sample order events</span><span className="checkout-outcome">Outcome: not measured yet</span></div>
    <div className="checkout-row checkout-next" {...at(6)}><span className="checkout-kind">Next change request</span><strong>Show the points balance</strong></div>
  </figure>;
}
