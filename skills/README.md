# drizzle-solid Skills

This directory contains the first public skill pack for `drizzle-solid`.

These skills are meant to complement:

- `README.md`
- `docs/guides/`
- `examples/`
- `docs/guides/context7-and-skills.md`
- `docs/guides/issue-triage.md`

They are the canonical public skill sources for this repository. Future Context7 Skills publishing should derive from this directory, not from ad-hoc chat prompts.

Testing-specific rule:

- `docs/guides/testing.md` is the canonical testing policy
- historical test strategy/report files in the repo root or `docs/` are background inputs only; they do not override `docs/guides/testing.md`

## Included skills

- `solid-modeling` — model Solid/RDF concepts, classes, predicates, links, and ownership boundaries
- `drizzle-solid-migration` — migrate Drizzle-style code and SQL habits to the `drizzle-solid` surface
- `pod-layout-design` — choose `base`, `subjectTemplate`, IRI layout, and document/container organization
- `drizzle-solid-testing` — place tests correctly across unit, integration, examples, and issue regressions

## Scope

These skills are public-facing guidance assets.

They are intentionally narrower and more stable than local/private agent instructions. Public skills should only encode:

- supported public APIs
- documented best practices
- repeatable workflows that external users should rely on

They should not depend on unpublished memory or private operational context.

Stable cross-skill modeling rule:

- use `subClassOf` for class hierarchy
- keep one authoritative, most-specific instance `rdf:type` by default
- do not duplicate the same class-membership meaning into parent `rdf:type` materialization plus a parallel string `kind/type` field unless the semantics are genuinely different

Stable cross-skill execution rule:

- if a path is semantically exact-target, it must stay exact or fail explicitly
- do not recommend silently widening exact-target paths into scan-style execution
- for multi-variable `subjectTemplate`, exact-target joins must carry the full locator or a full IRI; this is an application of the rule above

## Feedback loop

If a skill recommendation is unclear, incomplete, or wrong, the feedback should return to this repository as an issue.

Use the existing issue taxonomy:

- `kind:code` — runtime/API behavior contradicts the skill
- `kind:docs` — docs/examples do not support the recommendation
- `kind:tooling` — local workflow, test, or integration tooling blocks adoption
- `kind:decision` — the modeling rule or API direction is not settled yet

Skill content should be updated only after the public source of truth is clarified in docs, examples, tests, or decisions.

For ontology / predicate / IRI disputes, a single AI answer is not enough. Route the question through a modeling decision flow first, then update the skill after the decision stabilizes.
