# drizzle-parity-investigate.test parity board

- Total unique cases: 3
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Investigate Later

- Status: `investigate`
- Count: 3
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P3

- [ ] proper json and jsonb handling (2 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:4401, pg/pg-common.ts:4993
  - Tags: driver-api, insert, json-operator, select, sql-fragment, subquery
  - Notes: SQL JSON operators do not map directly onto the Solid query-builder surface.
- [ ] set json/jsonb fields with objects and retrieve with the ->> operator (4 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:4435, bun/bun-sql.test.ts:4483, pg/pg-common.ts:5029, pg/pg-common.ts:5081
  - Tags: insert, json-operator, select
  - Notes: SQL JSON operators do not map directly onto the Solid query-builder surface.
- [ ] set json/jsonb fields with strings and retrieve with the ->> operator (4 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:4459, bun/bun-sql.test.ts:4507, pg/pg-common.ts:5055, pg/pg-common.ts:5107
  - Tags: insert, json-operator, select, sql-fragment
  - Notes: SQL JSON operators do not map directly onto the Solid query-builder surface.

