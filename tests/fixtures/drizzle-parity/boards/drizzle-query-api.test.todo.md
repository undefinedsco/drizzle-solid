# drizzle-query-api.test parity board

- Total unique cases: 3
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Investigate Later

- Status: `investigate`
- Count: 3
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P2

- [ ] [Find Many] Get users with posts + where + partial (7 variants)
  - Flags: fixture=yes, manual=yes
  - Sources: relational/bettersqlite.test.ts:569, relational/mysql.planetscale.test.ts:612, relational/mysql.test.ts:683, relational/pg.postgresjs.test.ts:685, relational/pg.test.ts:682, relational/turso.test.ts:595, relational/vercel.test.ts:658
  - Tags: eq, insert, query-api
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.
- [ ] [Find One] Get users with posts + orderBy (7 variants)
  - Flags: fixture=yes, manual=yes
  - Sources: relational/bettersqlite.test.ts:1959, relational/mysql.planetscale.test.ts:2000, relational/mysql.test.ts:2122, relational/pg.postgresjs.test.ts:2096, relational/pg.test.ts:2093, relational/turso.test.ts:1984, relational/vercel.test.ts:2085
  - Tags: eq, insert, order-by, query-api
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.
- [ ] [Find One] Get users with posts + where + partial (7 variants)
  - Flags: fixture=yes, manual=yes
  - Sources: relational/bettersqlite.test.ts:2065, relational/mysql.planetscale.test.ts:2106, relational/mysql.test.ts:2232, relational/pg.postgresjs.test.ts:2206, relational/pg.test.ts:2203, relational/turso.test.ts:2090, relational/vercel.test.ts:2195
  - Tags: eq, insert, query-api
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.

