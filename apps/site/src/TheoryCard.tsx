import React from 'react';

type Part = { field: string; text: string };
const part = (field: string, text: string): Part => ({ field, text });

// Continues home step 6: "Did loyalty points bring customers back? Not measured yet."
const sentence: (string | Part)[] = [
  'We build ', part('mechanism', 'loyalty points'), ' for ', part('beneficiary', 'returning shoppers'),
  ' because we believe they ', part('outcome', 'come back to buy again'), ', shown by ', part('indicator', 'repeat orders within 30 days'), '.',
];

/** The hero: one claim written as a sentence, each part labelled with the claim field that holds it. Sample data. */
export function TheoryCard() {
  return <figure className="theory-card" data-theory-card="">
    <figcaption className="theory-card-head"><span>A product theory</span><span className="term-label">claim</span></figcaption>
    <p className="theory-sentence">{sentence.map((item, index) => typeof item === 'string' ? item
      : <span key={index} className="theory-part" data-theory-part={item.field}><span className="theory-part-text">{item.text}</span><span className="theory-part-label" aria-hidden="true">{item.field}</span></span>)}</p>
    <p className="theory-card-status"><span className="claim-status" data-status="unknown"><span aria-hidden="true">○</span> unknown</span><span>Measurement in progress. Nothing measures the indicator yet.</span></p>
  </figure>;
}

const fields = [
  ['What we build', 'mechanism', 'Shoppers earn points on every order and spend them on the next one.'],
  ['For whom', 'beneficiaries', 'Returning shopper'],
  ['What should change', 'outcome', 'More shoppers come back to buy again.'],
  ['How we would see it', 'indicator', 'Share of shoppers with a repeat order within 30 days.'],
  ['How we would judge it', 'evaluationMethod', 'Compare the 30-day repeat rate before and after launch.'],
  ['What could fool us', 'limitation', 'Seasonal sales also move repeat orders.'],
] as const;

const statuses = [
  ['○', 'unknown', 'Not tested yet. Every claim starts here.'],
  ['◐', 'inconclusive', 'Tested; the evidence does not decide it.'],
  ['●', 'supported', 'The evidence agrees. Still a hypothesis.'],
  ['✕', 'challenged', 'The evidence disagrees. Time to revise.'],
] as const;

const rules = [
  ['theory.indicator', 'No indicator: nothing would show the claim works.'],
  ['theory.method', 'No evaluation method: no way to judge the indicator.'],
  ['theory.beneficiary', 'No one named who should benefit.'],
  ['theory.outcomeUnlinked', 'No criterion or requirement points at the claim.'],
] as const;

/** The fields of a theory claim, its four statuses and the Rule Pack checks that flag gaps. Sample data. */
export function ClaimAnatomy() {
  return <div className="claim-anatomy">
    <article className="claim-sheet" aria-labelledby="claim-sheet-title">
      <header><span className="term-label">claim</span><h3 id="claim-sheet-title">Loyalty points bring shoppers back</h3></header>
      <dl className="claim-fields">
        {fields.map(([plain, field, value]) => <div key={field} data-claim-field={field}><dt>{plain} <span className="term-label">{field}</span></dt><dd>{value}</dd></div>)}
        <div data-claim-field="status"><dt>Where it stands <span className="term-label">status</span></dt><dd><span className="claim-status" data-status="unknown"><span aria-hidden="true">○</span> unknown</span> Measurement in progress.</dd></div>
      </dl>
    </article>
    <div className="claim-side">
      <section aria-labelledby="claim-status-heading">
        <h3 id="claim-status-heading">Four honest answers</h3>
        <ul className="claim-statuses">
          {statuses.map(([glyph, status, meaning]) => <li key={status} data-status={status} aria-current={status === 'unknown' ? 'true' : undefined}><span className="claim-status" data-status={status}><span aria-hidden="true">{glyph}</span> {status}</span><span>{meaning}</span></li>)}
        </ul>
        <p className="claim-note">None of them is green. Measuring indicators automatically is still being built, so today every claim on this page reads unknown.</p>
      </section>
      <section aria-labelledby="claim-rules-heading">
        <h3 id="claim-rules-heading">Gaps get flagged</h3>
        <p>The <code>theory@1</code> Rule Pack reads every claim that is not deferred.</p>
        <ul className="claim-rules">{rules.map(([rule, meaning]) => <li key={rule}><code>{rule}</code><span>{meaning}</span></li>)}</ul>
      </section>
    </div>
  </div>;
}
