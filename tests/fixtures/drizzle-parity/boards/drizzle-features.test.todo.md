# drizzle-features.test parity board

- Total unique cases: 6
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Investigate Later

- Status: `investigate`
- Count: 6
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P2

- [ ] common › cross join (lateral) (2 variants)
  - Flags: fixture=no, manual=yes
  - Sources: mysql/mysql-common.ts:4344, pg/pg-common.ts:6102
  - Tags: insert, join-cross, like, not, order-by, select, subquery, where
  - Notes: Lateral/subquery join semantics are not part of the current Solid parity surface and need separate design.
- [ ] common › cross join (lateral) (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: singlestore/singlestore-common.ts:3802
  - Tags: eq, insert, join-cross, order-by, select, subquery, where
  - Notes: Lateral/subquery join semantics are not part of the current Solid parity surface and need separate design.

### P3

- [ ] common › insert with onConflict chained (.nothing -> .nothing) (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2289
  - Tags: insert, json-operator, on-conflict, order-by, select
  - Notes: SQL JSON operators do not map directly onto the Solid query-builder surface.
- [ ] common › insert with onConflict chained (.nothing -> .update) (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2209
  - Tags: insert, json-operator, on-conflict, order-by, select
  - Notes: SQL JSON operators do not map directly onto the Solid query-builder surface.
- [ ] common › insert with onConflict chained (.update -> .nothing) (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2169
  - Tags: insert, json-operator, on-conflict, order-by, select
  - Notes: SQL JSON operators do not map directly onto the Solid query-builder surface.
- [ ] common › insert with onConflict chained (.update -> .update) (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2249
  - Tags: insert, json-operator, on-conflict, order-by, select
  - Notes: SQL JSON operators do not map directly onto the Solid query-builder surface.

