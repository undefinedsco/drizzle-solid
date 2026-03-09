# drizzle-types.test parity board

- Total unique cases: 12
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Ready First

- Status: `direct`
- Count: 11
- Guidance: Public API behavior that should be implemented and verified first with real Solid fixtures.

### P0

- [ ] array types (2 variants)
  - Flags: fixture=no, manual=no
  - Sources: bun/bun-sql.test.ts:1963, pg/pg-common.ts:2186
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] char insert (2 variants)
  - Flags: fixture=no, manual=no
  - Sources: bun/bun-sql.test.ts:916, pg/pg-common.ts:967
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › $default function (1 variants)
  - Flags: fixture=no, manual=no
  - Sources: sqlite/sqlite-common.ts:501
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › insert bigint values (1 variants)
  - Flags: fixture=no, manual=no
  - Sources: sqlite/sqlite-common.ts:374
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] insert + select all possible dates (2 variants)
  - Flags: fixture=no, manual=no
  - Sources: mysql/mysql-custom.test.ts:731, singlestore/singlestore-custom.test.ts:741
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › insert with default values (1 variants)
  - Flags: fixture=no, manual=no
  - Sources: sqlite/sqlite-common.ts:641
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › insert with overridden default values (12 variants)
  - Flags: fixture=no, manual=no
  - Sources: bun/bun-sql.test.ts:945, gel/gel-custom.test.ts:242, mysql/mysql-common.ts:763, mysql/mysql-custom.test.ts:340, mysql/mysql-prefixed.test.ts:266, pg/awsdatapi.test.ts:439, pg/pg-common.ts:1002, pg/pg-custom.test.ts:272, singlestore/singlestore-common.ts:768, singlestore/singlestore-custom.test.ts:342, singlestore/singlestore-prefixed.test.ts:268, sqlite/sqlite-common.ts:650
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › json insert (11 variants)
  - Flags: fixture=no, manual=no
  - Sources: bun/bun-sql.test.ts:903, mysql/mysql-common.ts:750, mysql/mysql-custom.test.ts:327, mysql/mysql-prefixed.test.ts:255, pg/awsdatapi.test.ts:426, pg/pg-common.ts:952, pg/pg-custom.test.ts:259, singlestore/singlestore-common.ts:755, singlestore/singlestore-custom.test.ts:329, singlestore/singlestore-prefixed.test.ts:257, sqlite/sqlite-common.ts:724
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] select bigint (1 variants)
  - Flags: fixture=no, manual=no
  - Sources: bun/sqlite.test.ts:66
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › timestamp timezone (2 variants)
  - Flags: fixture=no, manual=no
  - Sources: mysql/mysql-common.ts:2277, mysql/mysql-prefixed.test.ts:1243
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › timestamp timezone (2 variants)
  - Flags: fixture=no, manual=no
  - Sources: singlestore/singlestore-common.ts:2203, singlestore/singlestore-prefixed.test.ts:1269
  - Tags: insert, order-by, select
  - Notes: Core query-builder behavior should map directly with Solid-specific fixtures.

## Investigate Later

- Status: `investigate`
- Count: 1
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P2

- [ ] $default function (2 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:721, pg/pg-common.ts:750
  - Tags: insert, returning, select
  - Notes: API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.

