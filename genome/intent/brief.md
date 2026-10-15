# Artyfact intent brief

## system

Artyfact is a collaboration platform for meaningful Systems. A System is the
purpose and governance wrapper around Things. A Thing may start with a Genome
only, with no source repository, Parts, or application binding.

## authoring

People describe a new System or an amendment to a local agent. The agent keeps
the person's statements, cited canonical sources, boundaries, exclusions,
assumptions, disagreements and consequential unanswered questions. It must not
state that a person agreed with a draft, that planned behavior is implemented,
or that executable evidence exists when it does not.

## integrity

The proposed intent-integrity capability checks a specific Genome snapshot and
its brief, manifest and selected template closure. Structural and semantic
results are separate. A passed automated result is not human agreement; a
semantic finding, uncertainty, unavailable provider or incomplete coverage
requires review or an explicit disposition. This capability is proposed in the
canonical design and is not represented here as shipped runtime behavior.

## review-and-evidence

Review is the unified inbox for imports, Genome approvals, Task selections and
integrated implementation promotions. Source artifacts, realized outputs and
runtime observations have separate identities. Runtime evidence remains
unknown without authoritative lineage and evaluation.

## boundaries

Local-agent authoring is sufficient. No hosted agent runner, automatic
implementation, mandatory source repository, mandatory Part, or automatic
semantic approval is introduced by this intent.

## local-self-development

The first bootstrap milestone is one improvement planned in local Artyfact, implemented by a local agent, tested on Cloudflare, approved in Artyfact, and run by the local instance. Use real Cloudflare Artifacts and retain local operator state across approved source checkouts. Hosted operation follows later. Development events and analytics are the first improvement; runtime application analytics remains separate.

## public-site

The public site tells one argument, owned once per page and echoed elsewhere.
Git hosts are a factory floor for information: files in, diffs out. Artyfact
keeps track of meaning, information with a purpose. Software, taken with the
people who build and use it, behaves like a living thing made of ideas and
keeps evolving. Many roles shape it continuously. Agents need rails and room.
Instead of specs for information, Artyfact keeps theories and ontologies for
meaning, seen through three views of one model: the Genome (what it should be,
the representation), the Proteome (what is being made: the agents and the code
they write, never the code alone) and the Phenome (what it does: the running
product, observed and measured). Once the theory says where and what must
change, the code is mostly translation, so simple Tasks can go to cheaper or
local models; results are still checked against the whole model.

Copy deck (exact strings; Tasks translate them into the pages):

- Home hero body: "A merge can be clean in Git and still break checkout.
  Git hosts are a factory floor for information: files in, diffs out.
  Artyfact keeps track of meaning, what the files are for, in a multi-level
  model of your product next to the code. Change requests, agent work,
  checks, merges, deploys and runtime events all link back to it."
- Home thesis band, after the hero. H2 "Files are information. Your product
  is meaning." Intro "Git records what changed. Artyfact also records why:
  who it is for, what it should do, and how you would know it worked."
  Beats, each with a link:
  - "A product is alive." "Taken together with the people who build and use
    it, software behaves like a living thing made of ideas. It copies, adapts
    and gets selected. It is never finished, so its model never is either."
    Link "See one change go around" to #home-system-story.
  - "Many hands, all the time." "Product, design, engineering, data and
    operations keep shaping it, before launch and long after, all from the
    same model." Link "See the practices it connects" to the practice stack.
  - "Rails and room." "Agents drift without limits and stall with too many.
    The platform has to strike the balance." Link "How agents thrive here"
    to #environment.
  - "The theory decides. The code translates." "Once the model says where
    and what must change, writing the code is mostly translation. Simple
    Tasks can go to cheaper models, even ones on your own machine." Link
    "What your agent works from" to /connect-agent#work.
  Three views, labelled with the explorer labels: Genome "What it should be"
  "The theory and ontology of your product: purposes, people, journeys,
  rules, and how you would know they hold."; Proteome "What is being made"
  "Your agents and the code they write, turning the Genome into something you
  can deploy."; Phenome "What it does" "The running product, observed and
  measured, tied back to the commit and the model." Link "Open the three
  views" to /model#model-parallel-views.
- Home model nesting intro: "A spec file is a good start. Artyfact keeps the
  meaning behind it in a typed, multi-level model (an ontology), from the
  whole System down to one button. Purposes, people, journeys, data,
  policies and criteria attach to the parts they describe."
- Home practice stack intro: "A product is shaped by many roles,
  continuously. Artyfact keeps the practices each of them already uses and
  ties every one to the same model of your product. Some are built in, some
  are extended, and some connect what you already write."
- Home agent environment Freedom zone, first item: "Any agent harness or LLM
  you run, including a cheaper or local model for simple Tasks."
- Home closing, step 2: "It gets its own fork, holding the code and the
  pinned model, with a brief naming what to realize. From there, the code is
  mostly translation."
- Home meta description: "A Git platform for teams of AI agents, on
  Cloudflare. Git tracks information; Artyfact tracks meaning: a model of
  your product next to the code that change requests, agent work, checks,
  merges, deploys and runtime events all link back to."
- /model hero body: "You build something for some people because you
  believe it will change something for them, and you know what would show
  it. Most teams keep that theory in their heads while the product keeps
  evolving around it. Artyfact writes it down as part of a multi-level
  model, builds against it, checks the work and watches what happens. A spec
  describes information; a theory carries meaning."
- /model three views intro: "Genome is what it should be: the theory and
  ontology. Proteome is what is being made: your agents and the code they
  write. Phenome is what it does: the running product you observe and
  measure. They are views you can open at any time, not stages one after
  another. The loop is how a change moves through them."
- /model benefits card "Context agents can use", append: "Once the model
  says where and what to change, the code is mostly translation, so a simple
  Task can go to a cheaper model."
- /model loop, Revise step body, append: "A product keeps evolving with the
  people who build and use it, so the theory does too."
- /connect-agent intro, append: "Your agent and the code it writes are the
  Proteome: the part that turns the model into something you can deploy."
- /connect-agent "What your agent works from": replace the cheaper-model
  sentence with "Because the agent has the whole model and an exact brief,
  the hard thinking is already written down: where and what to change. The
  code is mostly translation. Simple Tasks can go to a cheaper model, or one
  running on your own machine; the result is still checked against the whole
  model."
- /connect-agent meta description, append: "Simple Tasks can run on cheaper
  or local models."
- /how-it-works intro body: "People decide what changes. Agents build it,
  each in a private fork; with the change already pinned in the model, the
  build is mostly translation. Artyfact checks the work against the model and
  refuses anything stale. Open a phase to see who acts, what they run and
  what keeps the change safe."

Rules: keep every test-locked heading and string; plain words first with
product terms as labels; never frame existing practices as wrong; claim no
measured savings or outcomes; no "task packet", "meta-ontology" or
"provenance" in page text.
