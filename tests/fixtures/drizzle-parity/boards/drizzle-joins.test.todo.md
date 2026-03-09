# drizzle-joins.test parity board

- Total unique cases: 1
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Investigate Later

- Status: `investigate`
- Count: 1
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P2

- [ ] common › join subquery (3 variants)
  - Flags: fixture=yes, manual=yes
  - Sources: bun/bun-sql.test.ts:1615, pg/pg-common.ts:1816, sqlite/sqlite-common.ts:1234
  - Tags: aggregation-count, eq, group-by, insert, join-left, order-by, select, subquery
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.

