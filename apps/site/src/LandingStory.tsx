import React, { useCallback, useRef, useState } from 'react';
import { CheckoutScene } from './LandingSystemScene';
import { checkoutSteps } from './landingSystemData';
import { useLandingScroll } from './useLandingScroll';

/** Home-only centerpiece. Prerendered at step one; every step stays in the document. */
export function LandingStory() {
  const [step, setStepState] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const setStep = useCallback((index: number) => setStepState(Math.min(checkoutSteps.length - 1, Math.max(0, index))), []);
  const { enhanced, following, chooseStep } = useLandingScroll(root, setStep);
  return <div ref={root} className="checkout-story" data-step={step} data-enhanced={enhanced ? 'true' : undefined} data-following={following ? 'true' : undefined}>
    <div className="checkout-intro">
      <p className="eyebrow">Example · illustrative</p>
      <h2 id="checkout-heading">The clean merge that still breaks checkout.</h2>
      <p>An online store. One change request. Two agents.</p>
      <div className="checkout-contrast">
        <article><h3>On GitHub</h3><p>No conflicts. Merged.</p></article>
        <article><h3>On Artyfact</h3><p>Overlap on Place order. 1 rule failing.</p></article>
      </div>
    </div>
    <div className="checkout-body">
      <div className="checkout-stage">
        <div className="checkout-step-buttons" role="group" aria-label="Example steps" hidden={!enhanced}>
          {checkoutSteps.map((item, index) => <button key={item.title} type="button" aria-current={step === index ? 'step' : undefined} aria-label={`Step ${index + 1}: ${item.title}`} onClick={() => chooseStep(index)}>{index + 1}</button>)}
        </div>
        <CheckoutScene step={step} />
      </div>
      <ol className="checkout-steps">
        {checkoutSteps.map((item, index) => <li key={item.title} data-checkout-step={index} data-active={step === index ? 'true' : undefined}>
          <h3><span className="checkout-step-number">{index + 1}</span>{item.title}</h3>
          <p>{item.body}</p>
          {item.term && <span className="term-label">{item.term}</span>}
        </li>)}
      </ol>
    </div>
    <a className="text-link" href="/model#lifecycle">Explore each step</a>
  </div>;
}
