# drizzle-aggregations.test parity board

- Total unique cases: 1
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Investigate Later

- Status: `investigate`
- Count: 1
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P2

- [ ] common › select from a many subquery (4 variants)
  - Flags: fixture=yes, manual=yes
  - Sources: mysql/mysql-common.ts:1626, pg/pg-common.ts:1744, singlestore/singlestore-common.ts:1509, sqlite/sqlite-common.ts:1162
  - Tags: aggregation-count, eq, insert, select, subquery, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.

