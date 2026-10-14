import React from 'react';
import { SystemExplorer } from './SystemExplorer';
import { ClaimAnatomy, TheoryCard } from './TheoryCard';
import { TheoryLoop } from './TheoryLoop';
type ModelContentProps = { explorerHtml?: string; platform?: string | null };
// explorerHtml is trusted markup rendered from SystemExplorer at build time.
function Explorer({ html }: { html?: string }) {
  return html === undefined ? <div data-system-explorer=""><SystemExplorer /></div> : <div data-system-explorer="" dangerouslySetInnerHTML={{ __html: html }} />;
}
export function ModelContent({ explorerHtml, platform }: ModelContentProps) {
  return <div className="model-story" data-model-story="">
    <section className="model-story-intro theory-hero">
      <div className="theory-hero-text">
        <h1>Theory Driven Development</h1>
        <p className="theory-lede">Every product is a theory.</p>
        <p>You build something for some people because you believe it will change something for them, and you know what would show it. Most teams keep that theory in their heads. Artyfact writes it down as part of a multi-level model, builds against it, checks the work and watches what happens.</p>
        <p>The ontology is the vocabulary. The theory is what you write in it.</p>
      </div>
      <TheoryCard />
      <nav className="model-story-jumps" aria-label="On this page"><a href="#lifecycle">How a change moves</a><a href="#claim-anatomy">What a theory is made of</a><a href="#meta-ontology">The vocabulary</a><a href="#model-parallel-views">Three views</a><a href="#benefits">Why it helps</a></nav>
    </section>

    <section id="lifecycle" className="section model-lifecycle" aria-labelledby="lifecycle-heading" tabIndex={-1}>
      <div className="section-heading"><h2 id="lifecycle-heading">How a change moves.</h2><p>Theory, build, check, ship, observe, then revise the theory. Each step names the product term it uses. Open a step to see what Artyfact does there.</p></div>
      <TheoryLoop />
    </section>

    <section id="claim-anatomy" className="section model-claims" aria-labelledby="claim-anatomy-heading" tabIndex={-1}>
      <div className="section-heading"><h2 id="claim-anatomy-heading">What a theory is made of.</h2><p>A purpose says why the product exists and for whom. Claims say how you expect to get there, in fields a check can read. This is the loyalty points claim from the card above. <span className="term-label">theory.yaml</span></p></div>
      <ClaimAnatomy />
      <p className="model-story-bridge">Artyfact’s own model has claims like this. <code>claim.evidence-gate</code>, “Evidence before green”, says a promote that treats unknown as blocking keeps unverified changes off the System head. Its status is unknown.</p>
    </section>

    <section id="meta-ontology" className="section model-story-shape" aria-labelledby="meta-ontology-heading" tabIndex={-1}>
      <div className="section-heading"><h2 id="meta-ontology-heading">The vocabulary: a multi-level model.</h2><p>The ontology defines the kinds, from a whole System down to one Affordance, plus the purposes and criteria that attach to them. Your theory and design fill them in. Here they are filled in with this page. A Thing is one app or service you deploy. A Section groups related parts of it. An Affordance is something a person can do on screen. <span className="term-label">meta ontology</span></p></div>
      <div className="model-self-portrait" role="group" aria-label="Artyfact canonical containment from System to explanation component">
        <div className="model-self-system" data-model-subject="system.artyfact"><div className="model-self-caption"><span>System · the whole product</span><strong>Artyfact</strong></div>
          <div className="model-self-thing" data-model-subject="thing.site"><div className="model-self-caption"><span>Thing · one app you deploy</span><strong>Public site</strong></div>
            <div className="model-self-section" data-model-subject="thing.site.pages"><div className="model-self-caption"><span>Section · related parts</span><strong>Public pages</strong></div>
              <div className="model-self-page" data-model-subject="page.model"><div className="model-self-caption"><span>Page · /model</span><strong>A model that can explain itself.</strong></div><p className="model-self-purpose">Purpose: explain Artyfact and how its model works.</p>
                <div className="model-self-component" data-model-subject="component.model-explanation"><div className="model-self-caption"><span>Component</span><strong>Ontology explanation</strong></div><p>This very explanation has expectations of its own.</p>
                  <ul className="model-self-criteria"><li><strong>Represent Artyfact accurately</strong><span>Use its real subjects, boundaries and relationships.</span></li><li><strong>Communicate clearly</strong><span>Help a reader connect purpose, structure and evidence.</span></li><li><strong>Make the visual compelling</strong><span>Make the nesting tangible, legible and usable at every size.</span></li></ul>
                  <a className="model-self-affordance" href="#model-parallel-views" data-model-subject="affordance.model.inspect-views"><span>Affordance · something you can do</span>Inspect the parallel views</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="model-story-bridge">These subjects and criteria are declared in the repository’s <code>genome/</code> tree, and the component serves <code>purpose.explain-artyfact</code>. Declaring a criterion does not show that readers’ needs were met.</p>
    </section>

    <section className="section model-story-views" id="model-parallel-views" aria-labelledby="model-views-heading" tabIndex={-1}><div className="section-heading"><h2 id="model-views-heading">Three views of the same model.</h2><p>What it should be, what is being made, and what it does. Their product names are Genome, Proteome and Phenome. They are views you can open at any time, not stages one after another. The loop is how a change moves through them.</p></div><Explorer html={explorerHtml} /></section>

    <section id="benefits" className="section model-story-benefits" aria-labelledby="benefits-heading" tabIndex={-1}>
      <div className="section-heading"><h2 id="benefits-heading">Why write the theory down?</h2><p>People and agents work from the same reasons instead of guessing them.</p></div>
      <div className="model-benefits-grid">
        <article><details><summary><strong>Context agents can use</strong><span>Each Task arrives with its scope.</span></summary><p>A Task Packet carries the pinned Genome version, the model nodes the Task reads and writes, the paths it may change, its steps, its checks and its dependencies. The agent does not have to rebuild that from source files.</p></details></article>
        <article><details><summary><strong>Changes keep their reason</strong><span>An Evolution names the claims it affects.</span></summary><p>A change moves from request to code to review with its reason attached. When the theory changes, you can see which work it touched.</p></details></article>
        <article><details><summary><strong>Gaps show early</strong><span>Rule Packs flag a claim with nothing to measure.</span></summary><p>A claim with no indicator, no method or no beneficiary is flagged before anyone builds it. Every agent and reviewer checks against the same modeled rules.</p></details></article>
        <article><details><summary><strong>Evidence stays honest</strong><span>Unknown is a real answer.</span></summary><p>Checks give verdicts and claims carry a status. Only a pass is green. A deployment is not an outcome, and a passing check establishes only what that check measured.</p></details></article>
      </div>
      <h3 className="model-story-subheading">Keep the answers separate.</h3>
      <div className="model-story-questions">
        <article><h4>Does it represent Artyfact?</h4><p>Compare the explanation with the canonical model and implementation.</p></article>
        <article><h4>Does the page work?</h4><p>Check this version for usable controls, accessibility and responsive layout.</p></article>
        <article><h4>Does the explanation help?</h4><p>Ask readers. That indicator is not measured yet.</p></article>
      </div>
    </section>

    <section className="section model-where" aria-labelledby="model-where-heading">
      <div className="section-heading"><h2 id="model-where-heading">Where it lives.</h2><p>The model sits next to your code in Git. A Thing can start with its model alone, before any Parts or source code.</p></div>
      <dl className="model-where-list">
        <div><dt>Cloudflare</dt><dd>Source can be versioned through Cloudflare Artifacts, its Git-compatible repository service. A Thing maps to one or more artifacts, such as a Worker with static assets. A logical subject is not a deployed resource; source, build output and running resources stay distinct. <a className="text-link" href="/#cloudflare">See how it runs on Cloudflare</a></dd></div>
        <div><dt>Parts</dt><dd>Reusable model content, files and pinned dependencies that a Thing can compose. Composition records where each piece came from.</dd></div>
        <div><dt>Rule Packs</dt><dd>Checks over the model, such as <code>theory@1</code> for claims. The bundled authorization pack checks modeled policy coverage, not deployed security.</dd></div>
      </dl>
    </section>
    <section className="section closing model-story-close"><h2>Write the theory. Hand it to your agents.</h2><div><p>A Task Packet carries the pinned Genome version, the Task’s model nodes, paths, steps and checks into your agent’s workspace.</p><div className="model-close-actions"><a className="button primary u-brackets" href="/connect-agent">Bring your agent</a>{platform && <a className="text-link" href={platform}>Open the platform</a>}</div></div></section>
  </div>;
}
