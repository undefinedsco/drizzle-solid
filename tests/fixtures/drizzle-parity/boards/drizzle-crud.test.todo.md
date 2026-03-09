# drizzle-crud.test parity board

- Total unique cases: 4
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Ready First

- Status: `direct`
- Count: 4
- Guidance: Public API behavior that should be implemented and verified first with real Solid fixtures.

### P0

- [ ] common › insert many (9 variants)
  - Flags: fixture=no, manual=no
  - Sources: bun/bun-sql.test.ts:954, gel/gel-custom.test.ts:251, mysql/mysql-common.ts:772, mysql/mysql-custom.test.ts:349, mysql/mysql-prefixed.test.ts:273, pg/awsdatapi.test.ts:455, pg/pg-common.ts:1013, pg/pg-custom.test.ts:281, sqlite/sqlite-common.ts:737
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › insert + select (9 variants)
  - Flags: fixture=no, manual=no
  - Sources: bun/bun-sql.test.ts:888, gel/gel-custom.test.ts:227, mysql/mysql-common.ts:735, mysql/mysql-custom.test.ts:312, mysql/mysql-prefixed.test.ts:242, pg/awsdatapi.test.ts:390, pg/pg-common.ts:935, pg/pg-custom.test.ts:244, sqlite/sqlite-common.ts:710
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › select all fields (14 variants)
  - Flags: fixture=no, manual=no
  - Sources: bun/bun-sql.test.ts:665, bun/sqlite.test.ts:55, gel/gel-custom.test.ts:122, mysql/mysql-common.ts:571, mysql/mysql-custom.test.ts:203, mysql/mysql-prefixed.test.ts:128, pg/awsdatapi.test.ts:160, pg/neon-serverless.test.ts:422, pg/pg-common.ts:684, pg/pg-custom.test.ts:127, singlestore/singlestore-common.ts:574, singlestore/singlestore-custom.test.ts:205, singlestore/singlestore-prefixed.test.ts:130, sqlite/sqlite-common.ts:393
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.
- [ ] common › select partial (1 variants)
  - Flags: fixture=no, manual=no
  - Sources: sqlite/sqlite-common.ts:405
  - Tags: insert, select
  - Notes: Core CRUD parity candidate.

