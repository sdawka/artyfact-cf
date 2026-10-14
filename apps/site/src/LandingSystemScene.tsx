import React from 'react';

type Phase = 'done' | 'current' | 'next';
const phase = (from: number, step: number): Phase => from < step ? 'done' : from === step ? 'current' : 'next';
const lanes = [
  ['A', 'CheckoutButton.tsx', 'Working now', 'Fail: requires login', 'fail'],
  ['B', 'api/orders.ts', 'Working now', 'Pass', 'pass'],
] as const;

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
      {lanes.map(([task, file, order, verdict, kind]) => <div key={task} className="checkout-row checkout-lane" data-task={task} {...at(1)}>
        <span className="checkout-kind">Task {task} · private fork</span><code>{file}</code>
        <span className="checkout-order" {...at(1)}>{order}</span>
        <span className="checkout-verdict" data-verdict={kind} {...at(3)}><span className="glyph" aria-hidden="true">{kind === 'pass' ? '✓' : '✕'}</span> {verdict}</span>
      </div>)}
    </div>
    <div className="checkout-row checkout-overlap" {...at(2)}><span className="checkout-kind">Overlap, different files</span><strong>Both change Place order and its rule</strong></div>
    <div className="checkout-row checkout-promote" {...at(4)}><span className="checkout-kind">Promote</span><strong>B integrated and promoted</strong><span>A updated onto B, revising</span></div>
    <div className="checkout-row checkout-deploy" {...at(5)}><span className="checkout-kind">Deployed</span><code>3f9c2a1</code><span>42 sample order events</span><span className="checkout-outcome">Did loyalty points bring customers back? Not measured yet.</span></div>
    <div className="checkout-row checkout-next" {...at(6)}><span className="checkout-kind">Next change request</span><strong>Show the points balance</strong></div>
  </figure>;
}
