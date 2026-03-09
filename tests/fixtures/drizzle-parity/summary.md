# Drizzle Parity Summary

- Generated: 2026-03-07T15:40:53.044Z
- Source root: `/tmp/drizzle-orm/integration-tests/tests`
- Parsed files: 94
- Parsed tests: 2499
- Unique parity cases: 895

## By Status

| Status | Raw tests | Unique cases |
| --- | ---: | ---: |
| direct | 81 | 20 |
| adapted | 74 | 17 |
| investigate | 156 | 30 |
| skip | 2188 | 828 |

## By Priority

| Priority | Raw tests | Unique cases |
| --- | ---: | ---: |
| P0 | 81 | 20 |
| P1 | 74 | 17 |
| P2 | 156 | 30 |
| P3 | 2188 | 828 |

## Suggested Targets

- `tests/integration/css/drizzle-aggregations.test.ts`: 8 unique cases
- `tests/integration/css/drizzle-batch.test.ts`: 6 unique cases
- `tests/integration/css/drizzle-crud.test.ts`: 4 unique cases
- `tests/integration/css/drizzle-features.test.ts`: 4 unique cases
- `tests/integration/css/drizzle-joins.test.ts`: 11 unique cases
- `tests/integration/css/drizzle-operators.test.ts`: 2 unique cases
- `tests/integration/css/drizzle-query-api.test.ts`: 11 unique cases
- `tests/integration/css/drizzle-returning.test.ts`: 9 unique cases
- `tests/integration/css/drizzle-types.test.ts`: 12 unique cases

## Selection Standard

- Prefer migration-relevant Drizzle public API behavior over raw test count.
- Deduplicate repeated dialect variants and keep one representative parity case per behavior unit.
- Only promote cases that can run against a real Solid Pod/CSS flow; do not keep SQL-engine-only placeholders.
- `direct` = core CRUD/query-builder behavior; `adapted` = Solid fixtures/assertions required; `investigate` = semantics still need design; `skip` = SQL/driver-specific surface.
- `needsFixture` and `needsManualAssertion` stay explicit so generated output never pretends a case is plug-and-play when it is not.

## Notes

- `all-tests.json` keeps every upstream `test()` / `it()` occurrence.
- `queue.json` deduplicates repeated dialect variants and is the main implementation queue.
- `tests/integration/css/generated-parity/*.parity.todo.test.ts` emits one `test.todo()` skeleton per non-skip, not-yet-implemented queue item.
- Queue items marked `direct` are the best first wave for Solid parity implementation.
- Queue items marked `adapted` or `investigate` still need hand-written fixtures and assertions.
