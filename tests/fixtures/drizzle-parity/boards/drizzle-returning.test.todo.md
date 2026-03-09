# drizzle-returning.test parity board

- Total unique cases: 2
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Investigate Later

- Status: `investigate`
- Count: 2
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P2

- [ ] insert with array values works (3 variants)
  - Flags: fixture=no, manual=yes
  - Sources: pg/awsdatapi.test.ts:1196, pg/awsdatapi.test.ts:1227, pg/awsdatapi.test.ts:1258
  - Tags: insert, returning
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.
- [ ] update with array values works (3 variants)
  - Flags: fixture=no, manual=yes
  - Sources: pg/awsdatapi.test.ts:1209, pg/awsdatapi.test.ts:1240, pg/awsdatapi.test.ts:1271
  - Tags: eq, insert, returning, update, where
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.

