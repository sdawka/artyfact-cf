import React from 'react';
import { SystemExplorer } from './SystemExplorer';
type ModelContentProps = { explorerHtml?: string };
// explorerHtml is trusted markup rendered from SystemExplorer at build time.
function Explorer({ html }: { html?: string }) {
  return html === undefined ? <div data-system-explorer=""><SystemExplorer /></div> : <div data-system-explorer="" dangerouslySetInnerHTML={{ __html: html }} />;
}
export function ModelContent({ explorerHtml }: ModelContentProps) {
  return <div className="model-story" data-model-story="">
    <section className="model-story-intro">
      <h1>Ontology Driven Development</h1>
      <p>Code repositories and delivery pipelines hold files, versions, builds and deployments. A semantic layer connects that work to its purpose, subjects, relationships and evidence. This page belongs to the model it explains.</p>
      <p>A System holds one or more Things you want to make. You choose their boundaries and connect their subjects within a typed model.</p>
    <nav className="model-story-jumps" aria-label="On this page"><a href="#benefits">Why a semantic layer</a><a href="#meta-ontology">Artyfact’s meta ontology</a></nav>
    </section>
    <section className="model-cloudflare" aria-labelledby="model-cloudflare-heading">
      <div><h2 id="model-cloudflare-heading">The model meets Cloudflare.</h2><p>Things and Parts can correspond to one or more artifacts, including compositions. The model connects those artifacts to their purpose.</p></div>
      <dl><div><dt>Thing</dt><dd>This site: Worker + static assets. The platform: Worker + assets + Durable Object + Queue. Either can be one Thing.</dd></div><div><dt>Part</dt><dd>Reusable model content, files and pinned dependencies contribute to a Thing’s realization. A Part need not deploy independently.</dd></div></dl>
      <p className="model-cloudflare-note">No fixed one-to-one mapping: a Thing can start without an artifact; a logical subject is not a deployed resource. Source can be versioned through Cloudflare Artifacts, its Git-compatible repository service; source, build output and running resources stay distinct.</p>
    </section>
    <section id="benefits" className="section model-story-benefits" aria-labelledby="benefits-heading" tabIndex={-1}>
      <div className="section-heading"><h2 id="benefits-heading">Why add a semantic layer?</h2><p>Keep meaning alongside code. Explore what the semantic layer makes possible.</p></div>
      <div className="model-benefits-grid">
        <article><details><summary><strong>Reuse context</strong><span>Give purpose and definitions a shared home.</span></summary><p>Give purpose, domain definitions and constraints a shared home. Carry relevant context into each task or agent session instead of reconstructing it from source files.</p></details></article>
        <article><details><summary><strong>Scope implementation precisely</strong><span>Name what changes and where it lives.</span></summary><p>Break a requested change into named subjects, then associate those subjects with their source areas. Tasks can say which screen, operation or policy they affect.</p></details></article>
        <article><details><summary><strong>Understand dependencies</strong><span>Follow relationships to related work.</span></summary><p>Make relationships explicit across features, interfaces and data. Follow those links to identify related subjects and reason about the impact of a change.</p></details></article>
        <article><details><summary><strong>Preserve intent</strong><span>Keep the reason connected to the code.</span></summary><p>Keep implementation decisions connected to the requirements and purpose behind them. A change retains its reason as it moves from a request into code and review.</p></details></article>
        <article><details><summary><strong>Share constraints</strong><span>Plan and check against shared expectations.</span></summary><p>Attach criteria to the subjects they assess and reuse modeled rules across work. People and agents can refer to the same expectations when planning and checking changes.</p></details></article>
        <article><details><summary><strong>Trace evidence</strong><span>See what was checked and what is missing.</span></summary><p>Associate checks and observations with the subjects and versions they assess. See what was tested, what was observed and where evidence is still missing.</p></details></article>
      </div>
    </section>

    <section id="meta-ontology" className="section model-story-shape" aria-labelledby="meta-ontology-heading" tabIndex={-1}>
      <div className="section-heading"><h2 id="meta-ontology-heading">Artyfact’s meta ontology</h2><p>The meta ontology defines the kinds and relationships used to describe projects. Artyfact’s own canonical Genome fills that vocabulary with this site, this page and the explanation you are reading. You are inside the example.</p></div>
      <div className="model-self-portrait" role="group" aria-label="Artyfact canonical containment from System to explanation component">
        <div className="model-self-system" data-model-subject="system.artyfact"><div className="model-self-caption"><span>System</span><strong>Artyfact</strong></div>
          <div className="model-self-thing" data-model-subject="thing.site"><div className="model-self-caption"><span>Thing</span><strong>Public site</strong></div>
            <div className="model-self-section" data-model-subject="thing.site.pages"><div className="model-self-caption"><span>Section</span><strong>Public pages</strong></div>
              <div className="model-self-page" data-model-subject="page.model"><div className="model-self-caption"><span>Page · /model</span><strong>A model that can explain itself.</strong></div><p className="model-self-purpose">Purpose: explain Artyfact and how its model works.</p>
                <div className="model-self-component" data-model-subject="component.model-explanation"><div className="model-self-caption"><span>Component</span><strong>Ontology explanation</strong></div><p>This very explanation has expectations of its own.</p>
                  <ul className="model-self-criteria"><li><strong>Represent Artyfact accurately</strong><span>Use its real subjects, boundaries and relationships.</span></li><li><strong>Communicate clearly</strong><span>Help a reader connect purpose, structure and evidence.</span></li><li><strong>Make the visual compelling</strong><span>Make the nesting tangible, legible and usable at every size.</span></li></ul>
                  <a className="model-self-affordance" href="#model-parallel-views" data-model-subject="affordance.model.inspect-views"><span>Affordance</span>Inspect the parallel views</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="model-story-bridge">The explanation component serves <code>purpose.explain-artyfact</code>. These subjects and criteria are declared in the repository’s <code>genome/</code> tree. Nested subjects are not additional Things or Parts; declaring expectations does not establish that readers’ needs have been met.</p>
      <h3 className="model-story-subheading">A Thing has form and content.</h3>
      <div className="model-story-pair"><article><h3>Form</h3><p>Named subjects and relationships give the Thing structure. That form gives you criteria for properly planning its fulfillment. A page contains a component, and the component contains an affordance. Here, accuracy, clarity and visual quality attach to the explanation component.</p></article><article><h3>Content</h3><p>These words, the nested illustration and the view controls fill that form. Their authored source and assets realize concrete choices. Source and each build output keep distinct identities.</p></article></div>
    </section>
    <section className="section model-story-reuse"><div className="section-heading"><h2>Reuse work; keep constraints visible.</h2><p>A Thing can begin with its Genome alone. It needs neither Parts nor source code. Composition is a choice, and the Thing remains the subject.</p></div><div className="model-story-pair"><article><h3>Parts</h3><p>Parts carry reusable implementation or model content. A component-system Part could contribute the typography or controls used here. A Part is incomplete in context until selected and composed, even when the package contains a complete template; composition records provenance.</p></article><article><h3>Rule Packs</h3><p>Rule Packs check shared constraints against modeled subjects. The bundled authorization pack checks modeled policy coverage, not deployed security. A visual criterion still needs review; naming it does not create an automated design-compliance check.</p></article></div><p className="model-story-rule-note">A design system can use both: a Part contributes components, while a Rule Pack constrains modeled relationships. It may also be a Thing in its own right.</p></section>
    <section className="section model-story-views" id="model-parallel-views"><div className="section-heading"><h2>The same explanation, three views.</h2><p>Genome states its intended shape, Proteome describes realization and checking, and Phenome asks what is observed. These are parallel views, not successive build stages.</p></div><Explorer html={explorerHtml} /></section>
    <section className="section model-story-answers"><div className="section-heading"><h2>Keep the answers separate.</h2><p>A modeled purpose, a rendered page and an understood explanation are different kinds of evidence.</p></div><div className="model-story-questions"><article><h3>Does it represent Artyfact?</h3><p>Compare the explanation with the canonical model and implementation.</p></article><article><h3>Does the page work?</h3><p>Check this version for usable controls, accessibility and responsive layout.</p></article><article><h3>Does the explanation help?</h3><p>Ask readers what became clear. A passing check establishes only what that check measured.</p></article></div></section>
    <section className="section closing model-story-close"><h2>Give the work a shared direction.</h2><div><p>Artyfact keeps intent, coordinated work, explicit expectations and traceable observations around the same subjects. A Task Packet carries relevant context into your agent’s workspace.</p><a className="button primary u-brackets" href="/connect-agent">Bring your agent</a></div></section>
  </div>;
}
