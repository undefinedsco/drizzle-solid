---
name: pod-layout-design
description: Design Pod storage layout for drizzle-solid. Use this skill when choosing base paths, subjectTemplate patterns, document boundaries, IRI structure, and container organization for Solid data.
---

# Pod Layout Design

Use this skill when the task is about **where data lives** and **how IRIs are formed**.

## Apply this skill when

- Choosing `base`
- Choosing `subjectTemplate`
- Deciding one-document-many-entities vs one-entity-per-document
- Designing container hierarchy
- Explaining how write targeting depends on layout

## Core rules

### 1. Treat `base` and `subjectTemplate` as first-class design decisions

These are not incidental config values. They determine:

- document boundaries
- IRI structure
- write targeting requirements
- operational ergonomics for reading and updating data

### 2. Separate semantic identity from storage layout

IRI generation is important, but not every layout variable should become a modeled field or ontology predicate.

### 3. Prefer predictable layouts

Recommend layouts that make exact-target reads and writes easy to explain and verify.

Common patterns:

- `#{id}`
- `{id}.ttl`
- `{id}.ttl#it`
- `{parentId}/messages.ttl#{id}`

### 4. Public vs private vs app-owned data should be explicit

Layout decisions should reflect visibility, ownership, and expected access patterns.

## Design checklist

1. What is the stable identity of the entity?
2. Do multiple entities belong in one document or many?
3. Which variables must be present to reconstruct the IRI?
4. Will users need exact-target updates frequently?
5. Does this layout keep the resulting docs understandable?

## Output expectations

When using this skill, produce:

- a recommended `base`
- a recommended `subjectTemplate`
- notes on document granularity
- notes on how the chosen layout affects reads and writes
- warnings if the proposed layout leaks too much implementation detail into the model

If the layout rule is not yet documented or conflicts with existing examples, recommend a `kind:docs` or `kind:decision` issue.
