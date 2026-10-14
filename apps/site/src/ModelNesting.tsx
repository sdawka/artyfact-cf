import React from 'react';

const alongside = [
  ['Purpose', 'Let shoppers buy in under a minute.'],
  ['People', 'Guest shopper, member'],
  ['Journey', 'Browse to paid order'],
  ['Entity', 'Order: items, total, points'],
  ['Policy', 'Guests may order without an account.'],
  ['Criterion', 'Guests can still check out.'],
] as const;

/** Static illustration; reuses the /model nesting styles. Sample data. */
export function ModelNesting() {
  return <section className="section model-nesting" aria-labelledby="model-nesting-heading">
    <div className="section-heading"><h2 id="model-nesting-heading">A model of the whole product, not just a spec.</h2><p>A spec file is flat text. Artyfact keeps a typed, multi-level model (an ontology), from the whole System down to one button. Purposes, people, journeys, data, policies and criteria attach to the parts they describe. <span className="term-label">Genome</span></p></div>
    <div className="model-nesting-layout">
      <div className="model-self-portrait" role="group" aria-label="Illustrative model of an online store, from System to one affordance">
        <div className="model-self-system"><div className="model-self-caption"><span>System</span><strong>Online store</strong></div>
          <div className="model-self-thing"><div className="model-self-caption"><span>Thing</span><strong>Storefront</strong></div>
            <div className="model-self-section"><div className="model-self-caption"><span>Section</span><strong>Checkout</strong></div>
              <div className="model-self-page"><div className="model-self-caption"><span>Screen</span><strong>Review order</strong></div>
                <div className="model-self-component"><div className="model-self-caption"><span>Component</span><strong>CheckoutButton</strong></div>
                  <span className="model-self-affordance"><span>Affordance</span>Place order</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <dl className="model-nesting-alongside" aria-label="Linked to the same subjects">
        {alongside.map(([kind, value]) => <div key={kind}><dt>{kind}</dt><dd>{value}</dd></div>)}
      </dl>
    </div>
    <p className="model-nesting-note">Sample data. A Thing is one app or service you deploy. A Section groups related parts of it. An Affordance is something a person can do on screen. Templates add their own levels for Workers, CLIs, static sites, web apps and libraries. Artyfact is described with the same model. <a className="text-link" href="/model#meta-ontology">See Artyfact’s own model</a></p>
  </section>;
}
