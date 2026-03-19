# Drizzle Parity Summary

- Generated: 2026-03-17T15:19:40.513Z
- Source root: `/tmp/drizzle-orm/integration-tests/tests`
- Parsed files: 94
- Parsed tests: 2499
- Unique parity cases: 886
- Implemented active cases: 54
- Remaining active cases: 0

## By Status

| Status | Raw tests | Unique cases |
| --- | ---: | ---: |
| direct | 81 | 19 |
| adapted | 74 | 12 |
| investigate | 156 | 23 |
| skip | 2188 | 832 |

## By Priority

| Priority | Raw tests | Unique cases |
| --- | ---: | ---: |
| P0 | 81 | 19 |
| P1 | 74 | 12 |
| P2 | 156 | 23 |
| P3 | 2188 | 832 |

## Implementation Progress

| Scope | Count |
| --- | ---: |
| Active cases | 54 |
| Implemented | 54 |
| Remaining | 0 |

## Suggested Targets

- `tests/integration/css/drizzle-aggregations.test.ts`: 7 implemented, 0 remaining (7 total)
- `tests/integration/css/drizzle-batch.test.ts`: 6 implemented, 0 remaining (6 total)
- `tests/integration/css/drizzle-crud.test.ts`: 4 implemented, 0 remaining (4 total)
- `tests/integration/css/drizzle-features.test.ts`: 4 implemented, 0 remaining (4 total)
- `tests/integration/css/drizzle-joins.test.ts`: 4 implemented, 0 remaining (4 total)
- `tests/integration/css/drizzle-operators.test.ts`: 2 implemented, 0 remaining (2 total)
- `tests/integration/css/drizzle-query-api.test.ts`: 10 implemented, 0 remaining (10 total)
- `tests/integration/css/drizzle-returning.test.ts`: 7 implemented, 0 remaining (7 total)
- `tests/integration/css/drizzle-types.test.ts`: 10 implemented, 0 remaining (10 total)

## Selection Standard

- Prefer migration-relevant Drizzle public API behavior over raw test count.
- Deduplicate repeated dialect variants and keep one representative parity case per behavior unit.
- Only promote cases that can run against a real Solid Pod/CSS flow; do not keep SQL-engine-only placeholders.
- `direct` = core CRUD/query-builder behavior; `adapted` = Solid fixtures/assertions required; `investigate` = semantics still need design; `skip` = SQL/driver-specific surface.
- `needsFixture` and `needsManualAssertion` stay explicit so generated output never pretends a case is plug-and-play when it is not.

## Notes

- `all-tests.json` keeps every upstream `test()` / `it()` occurrence.
- `Unique parity cases` means the deduplicated candidate pool imported from upstream Drizzle tests; it is not the same thing as committed support scope.
- `skip` means the case was reviewed and intentionally excluded from the current Solid support surface, usually because it is SQL-engine-specific, driver-specific, or infrastructure-specific.
- `Active cases` means `direct + adapted + investigate`; this is the current scope that still matters for implementation tracking.
- `Implemented` is measured only within active cases. Do not read this summary as `implemented / total unique candidates`.
- `queue.json` is the behavior-level planning ledger; repeated dialect variants and `common` harness wrappers are collapsed into one parity item.
- `queue.json` keeps `implemented` and `sourceDedupeKeys` so progress stays explicit without losing source traceability.
- `tests/integration/css/generated-parity/*.parity.todo.test.ts` emits one `test.todo()` skeleton per non-skip, not-yet-implemented queue item.
- Queue items marked `direct` are the best first wave for Solid parity implementation.
- Queue items marked `adapted` or `investigate` still need hand-written fixtures and assertions.
