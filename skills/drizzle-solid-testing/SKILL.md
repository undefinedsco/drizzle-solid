---
name: drizzle-solid-testing
description: Test drizzle-solid features with the right level of proof. Use this skill when deciding whether behavior belongs in unit tests, integration tests, example verification, issue regressions, or parity tracking.
---

# drizzle-solid Testing

Use this skill when the task is about proving behavior, not only implementing it.

## Apply this skill when

- Adding coverage for a new feature
- Fixing an issue and choosing the right regression test
- Deciding whether a case belongs in unit or integration tests
- Keeping examples truthful and verifiable
- Importing or adapting Drizzle parity cases

## Core rules

### 0. Start from the canonical testing source

Current testing policy lives in `docs/guides/testing.md`.

Use these only as historical or planning inputs, not as the source of current requirements:

- `ACTION-PLAN.md`
- `TESTING_STRATEGY.md`
- `COMPLETE-REPORT.md`
- `EXECUTION-SUMMARY.md`
- `docs/TEST-STRATEGY.md`
- `docs/TEST-DIMENSIONS.md`
- `docs/TEST-DIMENSIONS-COMPLETE.md`
- `docs/TEST-COMPLETENESS.md`
- `docs/DRIZZLE-ORM-MAPPING.md`
- `docs/TEST-ANALYSIS.md`
- `FINAL-SUMMARY.md`

### 1. One behavior, one primary home

Choose the main test layer based on responsibility:

- unit: builders, mappers, URI resolution, pure logic
- integration: real Pod/CSS/xpod semantics
- examples: public walkthrough verification
- issue regression: user-reported bugs that must not recur
- parity tracking: imported Drizzle compatibility work

### 2. Real Pod behavior needs real integration proof

Do not treat CRUD, discovery, notifications, TypeIndex, or SPARQL behavior as mock-only concerns.

### 3. Examples are part of the product surface

If a public example changes, verification should change with it.

### 4. Bug fixes should leave behind a durable asset

Prefer a regression test plus any required docs/example update.

### 5. Optimizer and planner bugs need execution-path proof

If a failure depends on planner, optimizer, hydration, or an unexpected execution-mode shift, do not stop at a generic feature test.

Add targeted proof for the interaction point, typically combining:

- unit proof for plan / SPARQL shape when observable
- integration proof against real CSS / xpod behavior
- a named regression for the exact failing path

If the product rule is “keep exact-target behavior exact”, assert either the exact path or the explicit failure path. Do not reintroduce a widened scan just to make the test pass.

## Placement checklist

1. Is this pure logic or real Pod behavior?
2. Is this user-facing example guidance?
3. Is this a recurring compatibility case?
4. Is this tied to an issue and worth naming as a regression?
5. Does this depend on a specific execution path or optimizer route?
6. What is the smallest test that proves the behavior without duplication?

## Output expectations

When using this skill, produce:

- the correct test layer
- the target file or suite shape
- any example verification implications
- whether docs must update with the test

If the expected behavior is itself unclear, prefer opening or linking a `kind:decision` issue before adding misleading coverage.
