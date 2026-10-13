import React from 'react';
import { SystemExplorer } from './SystemExplorer';

type ModelContentProps = { explorerHtml?: string };

// explorerHtml is trusted markup rendered from SystemExplorer at build time.
function Explorer({ html }: { html?: string }) {
  return html === undefined
    ? <div data-system-explorer=""><SystemExplorer /></div>
    : <div data-system-explorer="" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The semantic-layer benefits, then the platform vocabulary illustrated by one proposed change. */
export function ModelContent({ explorerHtml }: ModelContentProps) {
  return <div className="model-story" data-model-story="">
    <section className="model-story-intro">
      <h1>Ontology Driven Development</h1>
      <p>Code repositories and delivery pipelines give files, versions, builds and deployments a home. Ontology Driven Development adds a semantic layer that describes what the work means: its purpose, named subjects, relationships, implementation areas and evidence.</p>
      <p>An ontology makes those concepts and connections explicit, giving people and agents a shared model to work with.</p>
      <nav className="model-story-jumps" aria-label="On this page">
        <a href="#benefits">Why a semantic layer</a>
        <a href="#meta-ontology">Artyfact’s meta ontology</a>
      </nav>
    </section>

    <section id="benefits" className="section model-story-benefits" aria-labelledby="benefits-heading" tabIndex={-1}>
      <div className="section-heading"><h2 id="benefits-heading">Why add a semantic layer?</h2><p>Keep the meaning of the work alongside the code. Named subjects and explicit relationships give context, tasks and evidence a place to connect.</p></div>
      <div className="model-benefits-grid">
        <article><h3>Reuse context</h3><p>Give purpose, domain definitions and constraints a shared home. Carry relevant context into each task or agent session instead of reconstructing it from source files.</p></article>
        <article><h3>Scope implementation precisely</h3><p>Break a requested change into named subjects, then associate those subjects with their source areas. Tasks can say which screen, operation or policy they affect.</p></article>
        <article><h3>Understand dependencies</h3><p>Make relationships explicit across features, interfaces and data. Follow those links to identify related subjects and reason about the impact of a change.</p></article>
        <article><h3>Preserve intent</h3><p>Keep implementation decisions connected to the requirements and purpose behind them. A change retains its reason as it moves from a request into code and review.</p></article>
        <article><h3>Share constraints</h3><p>Attach criteria to the subjects they assess and reuse modeled rules across work. People and agents can refer to the same expectations when planning and checking changes.</p></article>
        <article><h3>Trace evidence</h3><p>Associate checks and observations with the subjects and versions they assess. See what was tested, what was observed and where evidence is still missing.</p></article>
      </div>
    </section>

    <section id="meta-ontology" className="section model-meta-intro" aria-labelledby="meta-ontology-heading" tabIndex={-1}>
      <div className="section-heading"><h2 id="meta-ontology-heading">Artyfact’s meta ontology</h2><p>The meta ontology defines the kinds of subjects and relationships the platform uses to describe projects. A project’s own ontology fills that vocabulary with its particular purpose, Things and connections. Artyfact itself can be described with the same model.</p></div>
      <p className="model-meta-description">Artyfact treats your project as a System: its purpose, the people and services around it, and one or more Things you want to make. You choose how to divide the System into Things and connect their subjects within a typed model.</p>
      <p className="model-story-thread"><span>Illustrative target</span><strong>Make changes easy to scope and specify.</strong> We will follow one proposed change to Artyfact itself, from its place in the System to the evidence that could tell us whether it helped.</p>
    </section>

    <section className="section model-story-boundary">
      <div className="section-heading"><h2>The System is the outer boundary.</h2><p>A Thing can be a whole application or one of several connected pieces. Keep in Touch, the example named on our home page, aims for more wanted contact with consent and a calm experience. Its owner could choose either shape.</p></div>
      <div className="model-story-choices" aria-label="Two ways to divide Keep in Touch into Things">
        <article><p className="model-story-label">Keep in Touch System · one Thing</p><strong>Whole contact application</strong><p>Interface, API and data together.</p></article>
        <article><p className="model-story-label">Keep in Touch System · several Things</p><div className="model-story-choice-pieces"><strong>Frontend</strong><strong>API</strong><strong>Design system</strong></div><p>Separate Things with typed links between them.</p></article>
      </div>
      <p className="model-story-bridge">For the rest of this example, we choose the <strong>Artyfact System</strong> and one <strong>Platform web app Thing</strong>. The proposed change concerns how that app scopes a request before work starts.</p>
    </section>

    <section className="section model-story-shape">
      <div className="section-heading"><h2>Zoom into the Thing.</h2><p>The Thing is the boundary for the application. Inside it, named subjects give the proposed change a precise place. Nested subjects are not additional Things or Parts.</p></div>
      <div className="model-story-zoom">
        <div className="model-story-path" role="group" aria-label="Illustrative subjects nested inside the Artyfact Platform web app Thing">
          <div><span>System</span><strong>Artyfact</strong></div>
          <div><span>Thing</span><strong>Platform web app</strong></div>
          <div><span>Section</span><strong>Work</strong></div>
          <div><span>Screen</span><strong>Change request</strong></div>
          <div><span>Component</span><strong>Scope editor</strong></div>
          <div><span>Affordance</span><strong>Confirm intent</strong></div>
        </div>
        <div className="model-story-relations"><h3>Connections make the shape useful.</h3><p>In this illustrative model, Confirm intent invokes a mapping operation; that mapping affects an Evolution; a criterion attaches to the requested change.</p><p>A screen contains a component, and the component contains an affordance. Other Things could connect to this one through typed links chosen by the owner.</p></div>
      </div>
      <h3 className="model-story-subheading">A Thing has form and content.</h3>
      <div className="model-story-pair">
        <article><h3>Form</h3><p>Named subjects and relationships give the Thing structure. That form gives you criteria for properly planning its fulfillment. Here, the Scope editor belongs to the Change request screen; a criterion asks whether a reviewer can see the requested behavior and affected subjects before work starts.</p></article>
        <article><h3>Content</h3><p>Concrete choices fill that form: this request’s behavior, affected subjects, requirements and words, then any authored source and assets. A realized build is another outcome of the work. Source and each build output keep distinct identities.</p></article>
      </div>
    </section>

    <section className="section model-story-reuse">
      <div className="section-heading"><h2>Reuse work; keep constraints visible.</h2><p>A Thing can begin with its Genome alone. It needs neither Parts nor source code. Composition is a choice, and the Thing remains the subject.</p></div>
      <div className="model-story-pair">
        <article><h3>Parts</h3><p>Parts carry reusable implementation or model content. An optional Part could contribute scope-editor components to this proposed feature. A Part is incomplete in context until selected and composed, even when the package contains a complete template; composition records provenance.</p></article>
        <article><h3>Rule Packs</h3><p>Rule Packs check shared constraints against modeled subjects. The bundled authorization pack checks modeled policy coverage, not deployed security. Design conventions could become rules when the needed facts are modeled; this example does not claim a live design-compliance check.</p></article>
      </div>
      <p className="model-story-rule-note">A design system can use both: a Part contributes components, while a Rule Pack constrains modeled relationships. It may also be a Thing in its own right.</p>
    </section>

    <section className="section model-story-views">
      <div className="section-heading"><h2>See the same feature three ways.</h2><p>Genome states the intended shape, Proteome shows how agents could realize and check it, and Phenome asks what could be observed. These are parallel views, not successive build stages. This feature, its test and its events remain illustrative.</p></div>
      <Explorer html={explorerHtml} />
    </section>

    <section className="section model-story-answers">
      <div className="section-heading"><h2>Keep the answers separate.</h2><p>The proposed change is not complete just because it has a shape, a candidate or a stream of events.</p></div>
      <div className="model-story-questions">
        <article><h3>Was the scope clear before work?</h3><p>Could a reviewer inspect the requested behavior and affected subjects?</p></article>
        <article><h3>Did the candidate meet the stated criterion?</h3><p>Which checks ran against that exact version, and what did they establish?</p></article>
        <article><h3>Did people find scoping easier?</h3><p>That needs observations from people. A passing check establishes only what that check measured.</p></article>
      </div>
    </section>

    <section className="section closing model-story-close"><h2>Give the work a shared direction.</h2><div><p>Artyfact keeps intent, coordinated work, explicit expectations and traceable observations around the same subjects. A Task Packet carries relevant context into your agent’s workspace.</p><a className="button primary u-brackets" href="/connect-agent">Bring your agent</a></div></section>
  </div>;
}
