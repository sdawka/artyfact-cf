<!-- grreat:record id=goal.north-star kind=north_star role=north_star status=active level=1 parent=none obverse=goal.obverse -->
# Parts, Things, and their artifacts

- Outcome: Users can keep reusable Parts alongside Systems, compose or extract a Thing without forced decomposition, and inspect source, realized output, and runtime evidence with explicit lineage.
- Why: A whole application may be one Thing; reusable templates and component systems may overlap and need deliberate composition.
- Scope and constraints: Genome-first Things with zero Parts; optional reusable packages at any scale; saved results with provenance, explicit upgrades and review; CLI/agent authoring and browser inspection; preserve legacy templates, IDs, history, and review gates. One integration PR, bounded parallel workers.
- Success signals: The acceptance checks in [[roadmap]] pass. Both application home and public pages explain the shipped behavior accurately.
- Deferred scope: Live inheritance, automatic upgrades, a full browser composition editor, arbitrary server-side package commands, and inferring historical deployed output identity.

<!-- grreat:record id=goal.obverse kind=obverse role=obverse status=active level=2 parent=goal.north-star -->
## What would make the goal fail?

Silent overwrite of overlapping contributions, forced Parts or code for a new Thing, lost customizations/history, or runtime evidence attributed to an unverified Thing/output would invalidate the result.
