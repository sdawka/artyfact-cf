# artyfact design

artyfact is a System-centred collaboration platform on Cloudflare Workers and Artifacts: a typed model of a System (the Genome), views over it, and a multi-agent loop that realizes changes and promotes them by compare-and-swap.

- [model.md](model.md): metamodel, schemas, loader, validation, Keep in Touch encoding
- [backend.md](backend.md): Worker, Durable Object, Artifacts usage, agent protocol, hooks
- [ui.md](ui.md): views, routes, components, theme
- [rules.md](rules.md): Datalog engine and Rule Packs
- [semantic.md](semantic.md): System One question catalog and policy
- [facts.md](facts.md): the fact schema shared by the model and the rule packs
- [../architecture.md](../architecture.md): how a change moves through the Worker, Artifacts and the Durable Object
