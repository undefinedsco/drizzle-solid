---
name: solid-modeling
description: Model Solid/RDF data for drizzle-solid. Use this skill when designing Pod schemas, choosing predicates, deciding whether a concept should own a property, defining links, or aligning RDF semantics with public drizzle-solid APIs.
---

# Solid Modeling

Use this skill when the task is about **what data means**, not only how to write code.

## Apply this skill when

- Designing a new `podTable(...)` or `solidSchema(...)`
- Choosing between literal fields, `link(...)`, inverse links, or derived values
- Deciding whether a concept should own a predicate at all
- Choosing standard vocabularies vs custom terms
- Reviewing schema proposals for semantic consistency

## Core rules

### 1. Prefer semantic ownership over implementation convenience

Before attaching a predicate to a concept, ask:

- Is this a stable fact about the concept itself?
- Or is it a layout detail, runtime detail, query convenience, or derived value?

If the current concept is not the true owner, do **not** attach the predicate here.

### 2. Distinguish six outcomes

For every candidate property, classify it as one of:

- `Required`
- `Optional`
- `Link Instead`
- `Derived`
- `Belongs Elsewhere`
- `Forbidden`

Do not leave property ownership implicit.

### 3. Prefer links over fake foreign-key literals

If the value identifies another entity, prefer `uri(...).link(target)` and a stable IRI over a string id.

### 4. Keep class hierarchy separate from instance typing

Use:

- `subClassOf` for vocabulary / schema hierarchy
- one primary, most-specific `rdf:type` for persisted instances

By default:

- do **not** materialize parent classes as extra instance `rdf:type` values
- do **not** add a parallel string `type/kind` field if it only repeats class membership

If parent types are needed for no-inference environments, treat that as an explicit compatibility choice, not the default stored shape.

### 5. Keep layout separate from ontology

`base`, `subjectTemplate`, document bucketing, and container layout are important, but they are not automatically ontology predicates.

### 6. Reuse standard vocabulary first

Prefer standard RDF vocabularies when they fit the meaning. Introduce custom terms only when the semantics are genuinely project-specific.

### 7. Do not fake certainty on unsettled ontology choices

If multiple predicate, IRI, or ownership choices remain plausible, treat the answer as a proposal, not a final rule. Recommend a `kind:decision` + `area:modeling` path instead of pretending one choice is already canonical.

## Review checklist

When reviewing a schema or property proposal, answer these in order:

1. What real-world concept does this table represent?
2. Which fields are stable semantic facts?
3. Which fields are links to other entities?
4. Which values are derived from layout or IRI structure?
5. Which values belong on another concept, relation object, or runtime status object?
6. Which vocabulary terms are canonical for these meanings?
7. Is the proposal duplicating class membership across `rdf:type`, parent types, and string discriminators?

## Output expectations

When using this skill, produce:

- a recommended schema shape
- explicit property ownership decisions
- notes on `link` vs literal fields
- notes on `rdf:type` / `subClassOf` responsibilities
- notes on derived/layout-only values
- follow-up docs/example gaps if the modeling rule is not yet documented
- whether the question can be answered directly or must escalate to modeling consensus

## Escalate to issue when

Open or recommend an issue if:

- the property ownership decision is unclear across multiple valid options
- the public docs do not state the modeling rule
- current examples contradict the recommended semantic model
- the API encourages an anti-pattern that should be corrected

Prefer routing the issue as `kind:decision` when the semantic ownership rule itself is unsettled. If the disagreement is fundamentally about ontology choice, also treat it as `area:modeling` and avoid writing the answer back into public docs or skills until consensus is clearer.
