<!-- grreat:record id=goal.north-star kind=north_star role=north_star status=active level=1 parent=none obverse=goal.obverse -->
# From ontology to coordinated realization

- Outcome: Users can start a System with an imported or agent-authored ontology, map intent to source, approve Genome Evolutions, coordinate scoped Tasks under a pinned Realization, and review the integrated implementation and its Phenome. Reusable Parts and Thing composition remain supported.
- Why: The intended shape, its implementation and its observed functioning need a shared map and separate approvals. A whole application may be one Thing; reusable Parts remain optional.
- Scope and constraints: Genome-only Evolutions; Realization plans with Tasks and fenced agent attempts; open ontology packages and optional outcomes pack; base deployments, metrics and operational flags; Genome-first Things with zero Parts; optional reusable packages at any scale; saved results with provenance, explicit upgrades and review; CLI/agent authoring and browser inspection; preserve legacy templates, IDs, history, and review gates. One integration PR, bounded parallel workers.
- Success signals: The acceptance checks in [[roadmap]] pass. Both application home and public pages explain the shipped behavior accurately.
- Deferred scope: Live inheritance, automatic upgrades, a full browser composition editor, arbitrary server-side package commands, and inferring historical deployed output identity.

<!-- grreat:record id=goal.obverse kind=obverse role=obverse status=active level=2 parent=goal.north-star -->
## What would make the goal fail?

Mixing Genome approval with implementation approval, allowing conflicting writers, silently retargeting accepted work, overwriting contributions, forcing Parts or code for a new Thing, losing history, or attributing runtime evidence to an unverified Thing/output would invalidate the result.
