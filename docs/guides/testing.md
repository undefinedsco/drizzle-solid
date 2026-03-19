# Testing Guide

This document is the canonical testing reference for `drizzle-solid` and is the source we should keep aligned when publishing repository docs externally, including Context7 snapshots.

## Scope and precedence

Use this file as the current testing contract.

The following files are kept for background, planning history, or progress tracking only, and must not override this guide:

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

If a historical note conflicts with maintained tests, public docs, or current support scope, follow this guide.

## Goals

The test system answers five different questions:

1. **Unit**: does the local builder / mapper / utility logic behave correctly?
2. **Integration**: does the feature work against a real Solid Pod / CSS flow?
3. **Parity**: which Drizzle behaviors do we intentionally preserve, adapt, or reject?
4. **Examples**: are user-facing examples still truthful and runnable?
5. **Regression**: once we fix a bug, can it ever come back unnoticed?

Do not manage tests as “old tests” vs “new tests”. Manage them by responsibility.

## Test Layers

### Unit tests

- Location: `tests/unit`
- Purpose: fast feedback for pure logic, query builders, RDF mapping, type-level behavior, and helper utilities
- Typical scope:
  - AST / SPARQL generation
  - table metadata
  - subject / IRI resolution
  - type helpers
  - execution routing decisions

Run with:

```bash
yarn vitest --run tests/unit
```

### Integration tests

- Location: `tests/integration/css`
- Purpose: verify real Community Solid Server / Pod behavior
- Required for:
  - CRUD on Pod resources
  - TypeIndex flows
  - SPARQL endpoint behavior
  - discovery / notifications / cross-Pod access
  - any behavior whose correctness depends on actual Solid semantics

Run with:

```bash
yarn test:integration
```

This command defaults to the xpod in-process runtime when remote Solid credentials are absent.

- Set `SOLID_CLIENT_ID`, `SOLID_CLIENT_SECRET`, and `SOLID_OIDC_ISSUER` to target a remote Solid server with the same command
- Keep `SOLID_SERIAL_TESTS=true` so all real-Pod suites share predictable session behavior
- Use `XPOD_ENABLE_INPROCESS_TESTS=true` or `XPOD_ENABLE_INPROCESS_TESTS=false` only as a temporary manual override

The in-process mode still manages real CSS/xpod services and socket transport under the hood; it is not a mock runtime.

### Integration log policy

Integration runs should be quiet by default.

Rules:

- Treat test output as signal, not tracing
- Real integration runs default to suppressing `console.*` chatter in `vitest.setup.ts`; keep Vitest failure output, not trace spam
- The in-process xpod runtime should default to `logLevel=error`; set `XPOD_RUNTIME_LOG_LEVEL` only when you intentionally need CSS/xpod internals
- Keep failure output visible; only mute repeatable non-actionable lines
- Set `DRIZZLE_SOLID_TEST_VERBOSE=true` when debugging runtime startup, dependency patching, or low-level xpod/SPARQL flows

### In-process runtime invariants

The in-process xpod runtime is part of the real integration environment, so treat its lifecycle as test infrastructure, not as per-file fixture state.

Rules:

- Do not stop the shared in-process runtime from `setupFiles` `afterAll`; in Vitest that hook is file-scoped, not suite-global
- If global teardown is needed, use Vitest `globalSetup` / `teardown`, not per-file hooks pretending to be global cleanup
- Keep runtime startup and shutdown centralized in `tests/integration/css/xpod-runtime.ts`
- If a suite needs a Pod session, ask the shared helper for it; do not create competing runtime managers in test files

### In-process port policy

Port allocation for xpod must be owned by the runtime unless a developer explicitly pins ports for debugging.

Rules:

- Do not pre-allocate random loopback ports in the test helper and then hand them to xpod later
- The probe-then-bind pattern is racy and can still produce transient `EADDRINUSE` failures under fast restart or concurrent teardown
- By default, let `@undefineds.co/xpod/runtime` choose its own ports
- Only pass `XPOD_RUNTIME_GATEWAY_PORT`, `XPOD_RUNTIME_CSS_PORT`, or `XPOD_RUNTIME_API_PORT` through when those env vars are explicitly set
- If startup still hits a transient `EADDRINUSE` while ports are not pinned, retry startup in the helper; do not change test semantics to work around infrastructure races

Reasoning:

- Runtime-owned port binding keeps the choose-and-bind decision atomic
- Explicit pinned ports remain available for local debugging
- The retry path is a guardrail for short-lived socket release races, not a substitute for correct port ownership

### Parity tests

Parity work is tracked from upstream Drizzle tests, but the generated output is not the long-term source of truth.

- Source queue: `tests/fixtures/drizzle-parity/queue.json`
- Summary: `tests/fixtures/drizzle-parity/summary.md`
- Generator: `yarn parity:generate`
- Main landing zone today: `tests/integration/css/drizzle-*.test.ts`
- `queue.json` is behavior-level: repeated dialect variants and wrapper suites such as `common` are collapsed into one planning item
- Generated boards / `generated-parity` suites only list remaining non-skip items, not already-implemented coverage
- If the upstream `drizzle-orm` checkout is absent locally, the generator falls back to the committed `all-tests.json` manifest

Parity status meanings:

- `direct`: should map to current Solid behavior with little or no adaptation
- `adapted`: same public behavior, but requires Solid-specific fixtures or assertions
- `investigate`: semantics still need product/design judgment
- `skip`: SQL-engine-only or otherwise outside Solid support scope

Rules:

- Keep the queue as the planning ledger
- Keep hand-written integration suites as the maintained asset
- Treat generated skeletons as disposable scaffolding
- Only promote a parity case when it represents a real user-visible behavior we want to support

How to read the numbers:

- `Unique parity cases` = the deduplicated upstream candidate pool, not the promised support surface
- `skip` = reviewed and intentionally excluded from the current Solid support surface
- `active` = `direct + adapted + investigate`; this is the implementation-tracked scope
- `implemented` is measured against `active`, not against all unique candidates

So if the summary says `886 unique`, `832 skip`, `54 active`, `54 implemented`, the correct reading is:

- candidate pool: `886`
- current target surface: `54`
- implemented within current target surface: `54 / 54`
- intentionally out of current scope: `832`

### Example verification

Examples are not just runnable demos, and they are not just prose.
They are explanatory documents with a runnable verification path.

Current verification entry points:

- Canonical registry: `examples/manifest.json`
- Structural registry check: `yarn examples:check`
- Real example verification: `tests/integration/css/examples-verification.test.ts`
- Default real-test runtime: in-process xpod when remote `SOLID_*` credentials are absent
- Lightweight example functionality checks: `tests/unit/examples.test.ts`

Policy:

- Every user-facing example must have a verification path
- If an example demonstrates real Pod behavior, that proof belongs in integration tests
- If an example mainly demonstrates API construction or compile-time behavior, a unit-level proof is acceptable in addition to integration coverage
- README snippets should either come from `examples/` directly or be updated in the same change

### Regression tests

Bug fixes must leave behind a regression test.

Recommended placement:

- Pure logic regressions: `tests/unit`
- Pod / protocol regressions: `tests/integration/css`

Recommended naming:

- Prefer behavior-oriented names first
- If tied to a tracked bug, include the issue number in the test title or file name

Examples:

- `tests/unit/core/find-by-iri-regression.test.ts`
- `tests/integration/css/issues/issue-123-returning.test.ts`

## Execution-path coverage

Feature buckets alone are not enough for planner / optimizer bugs.

When a regression depends on how a query is executed rather than only what API was called, add proof for the execution path interaction itself.

Typical hotspots in this repository:

- exact-subject `FILTER`
- named-node `FILTER IN`
- wide `OPTIONAL`
- multi-valued `OPTIONAL`
- multi-pattern join / hydration interactions
- exact-target paths unexpectedly widening into collection scans

Recommended proof shape:

1. a unit test for plan or SPARQL generation when that path is observable
2. an integration test against real CSS / xpod behavior
3. a named regression test for the exact interaction that previously failed

For execution-mode-shift tests, prefer stateful/mutable builder doubles over immutable stubs so the test can catch bugs caused by reusing a builder after `.where()` / `.limit()` / similar mutating calls.

If the chosen product rule is “do not silently degrade”, the regression should assert the explicit failure path rather than reintroducing a scan fallback in the name of convenience.

## Ownership Rules

### One behavior, one primary home

Do not keep several unrelated suites asserting the same behavior in slightly different ways.

- Builder / translation semantics live in unit tests
- Real Pod semantics live in integration tests
- Imported Drizzle compatibility cases live in parity-tracked integration suites
- Bug reproductions live in regression tests
- User education flows live in examples and their verification tests

### Generated tests are proposals, not truth

If we generate tests in bulk, the generator is helping us scale triage. It is not defining product behavior by itself.

The maintained truth is:

1. public API and documented support scope
2. the parity queue (`queue.json`) for triage state
3. the hand-maintained test suites that actually run in CI

### Issue fixes require a test

Every bug fix should do all of the following when applicable:

- add the smallest useful failing test first
- fix the implementation
- keep the regression test in the main suite
- update docs or examples if user-visible behavior changed

## Example and Documentation Policy

Because docs may be published to external indexes such as Context7, examples must stay trustworthy.

Rules:

- Do not publish explanatory example code without a matching verification path
- Do not let README evolve separately from `examples/` for the same workflow
- If a public workflow changes, update these together in one change:
  - implementation
  - tests
  - example
  - README / guide text

Practical review checklist:

- Does the example still compile?
- Does the example still reflect the current public API?
- Is there a runnable verification path for the example?
- If the example touches Pod behavior, is there real integration coverage?

## Context7 Sync

Repository docs are synchronized to Context7 through `.github/workflows/context7-sync.yml`.

Rules:

- Keep `README.md`, `docs/`, and `examples/` aligned before merging user-facing API changes
- Ensure example verification stays green before publishing docs externally
- Configure `CONTEXT7_API_KEY` in GitHub Actions secrets
- Trigger sync by pushing doc/example changes to `main` or by running the workflow manually
- The GitHub Action performs `refresh` for the Context7 library; first-time registration should be done manually in the Context7 UI if the library page does not exist yet

## Recommended Workflow

### Adding a new feature

1. Add or update unit coverage for builder / mapping logic
2. Add integration coverage if the feature touches real Pod semantics
3. If the feature is part of the Drizzle-compatible surface, update the parity queue or parity suite
4. Update examples and README when the feature is public
5. Finish with full verification

### Importing a Drizzle parity case

1. Use `queue.json` to identify the case and its target suite
2. Implement the case in a maintained test file, usually under `tests/integration/css`
3. If Solid semantics differ, make the adaptation explicit in assertions
4. If the feature should not be supported, record that decision in the queue / docs rather than silently dropping it

### Fixing an issue

1. Reproduce with the smallest meaningful test
2. Fix the root cause
3. Keep the regression test
4. Update docs/examples if the behavior is user-visible

## Commands

### Fast local confidence

```bash
yarn vitest --run tests/unit
```

### Real Pod integration

```bash
yarn test:integration
```

To target a remote Solid server, export `SOLID_CLIENT_ID`, `SOLID_CLIENT_SECRET`, and `SOLID_OIDC_ISSUER` before running the same command.

### Parity queue refresh

```bash
yarn parity:generate
```

### Full project verification

```bash
yarn quality
```

## Current Repository Conventions

- `tests/unit` is currently green and should stay fast
- `tests/integration/css` is the primary place for real-behavior coverage and parity landing
- `tests/fixtures/drizzle-parity/queue.json` is the triage ledger for imported Drizzle cases
- `tests/integration/css/examples-verification.test.ts` is the canonical real-example verification entry point today
- `tests/unit/examples.test.ts` is supportive, but not a substitute for real example verification

## Review Standard for PRs

A PR is not ready just because code compiles.

For public behavior changes, reviewers should be able to answer yes to all of these:

- Is the behavior covered at the correct layer?
- If this is Drizzle-facing behavior, is parity intent explicit?
- If this fixes a bug, is there a regression test?
- If this changes user-facing usage, did examples and docs move with it?
- Can this be safely published to external documentation indexes without misleading users?
