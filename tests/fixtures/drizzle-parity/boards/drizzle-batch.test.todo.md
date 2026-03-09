# drizzle-batch.test parity board

- Total unique cases: 3
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Investigate Later

- Status: `investigate`
- Count: 3
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P2

- [ ] findMany + findOne api example (1 variants)
  - Flags: fixture=yes, manual=yes
  - Sources: sqlite/sqlite-proxy-batch.test.ts:335
  - Tags: batch, insert, query-api, returning
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.
- [ ] common › insert + findMany (4 variants)
  - Flags: fixture=yes, manual=yes
  - Sources: pg/neon-http-batch.ts:250, sqlite/d1-batch.test.ts:274, sqlite/libsql-batch.test.ts:286, sqlite/sqlite-proxy-batch.test.ts:421
  - Tags: batch, eq, insert, query-api, returning
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.
- [ ] common › insert + findMany + findFirst (4 variants)
  - Flags: fixture=yes, manual=yes
  - Sources: pg/neon-http-batch.ts:287, sqlite/d1-batch.test.ts:309, sqlite/libsql-batch.test.ts:321, sqlite/sqlite-proxy-batch.test.ts:456
  - Tags: batch, eq, insert, query-api, returning
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.

