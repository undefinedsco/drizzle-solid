# drizzle-operators.test parity board

- Total unique cases: 19
- Recommended flow: Ready First (direct) → Adapt Next (adapted) → Investigate Later (investigate)
- Legend: `fixture=yes/no`, `manual=yes/no`

## Investigate Later

- Status: `investigate`
- Count: 19
- Guidance: Semantics or API surface still need design decisions before implementation work starts.

### P2

- [ ] common › select from a one subquery (4 variants)
  - Flags: fixture=no, manual=yes
  - Sources: mysql/mysql-common.ts:1663, pg/pg-common.ts:1779, singlestore/singlestore-common.ts:1546, sqlite/sqlite-common.ts:1197
  - Tags: eq, insert, select, subquery, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.
- [ ] common › set operations (except) from query builder (5 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:3328, mysql/mysql-common.ts:3030, pg/pg-common.ts:3841, singlestore/singlestore-common.ts:2818, sqlite/sqlite-common.ts:2723
  - Tags: gt, select, set-operation, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.
- [ ] set operations (intersect all) as function (3 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:3292, mysql/mysql-common.ts:2992, pg/pg-common.ts:3803
  - Tags: eq, select, set-operation, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.
- [ ] common › set operations (intersect) as function (3 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:3229, pg/pg-common.ts:3736, sqlite/sqlite-common.ts:2687
  - Tags: eq, select, set-operation, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.
- [ ] common › set operations (intersect) from query builder (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: mysql/mysql-common.ts:2894
  - Tags: gt, select, set-operation, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.
- [ ] common › set operations (mixed) from query builder (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2792
  - Tags: eq, gt, select, set-operation, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.
- [ ] set operations (mixed) from query builder with subquery (2 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:3461, pg/pg-common.ts:3982
  - Tags: eq, gt, select, set-operation, subquery, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.
- [ ] common › set operations (union all) as function (3 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:3161, pg/pg-common.ts:3664, sqlite/sqlite-common.ts:2616
  - Tags: eq, select, set-operation, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.
- [ ] common › set operations (union) as function (2 variants)
  - Flags: fixture=no, manual=yes
  - Sources: mysql/mysql-common.ts:2785, singlestore/singlestore-common.ts:2633
  - Tags: eq, select, set-operation, where
  - Notes: Advanced builder behavior likely needs manual adaptation for Solid execution.

### P3

- [ ] common › insert conflict with ignore (6 variants)
  - Flags: fixture=no, manual=yes
  - Sources: mysql/mysql-common.ts:1080, mysql/mysql-custom.test.ts:499, mysql/mysql-prefixed.test.ts:404, singlestore/singlestore-common.ts:1091, singlestore/singlestore-custom.test.ts:501, singlestore/singlestore-prefixed.test.ts:411
  - Tags: eq, insert, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] common › insert with onConflict do nothing (5 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:1484, pg/awsdatapi.test.ts:1013, pg/pg-common.ts:1603, pg/pg-custom.test.ts:766, sqlite/sqlite-common.ts:2016
  - Tags: eq, insert, on-conflict, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] insert with onConflict do nothing + target (4 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:1497, pg/awsdatapi.test.ts:1029, pg/pg-common.ts:1618, pg/pg-custom.test.ts:783
  - Tags: eq, insert, on-conflict, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] common › insert with onConflict do nothing using composite pk (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2036
  - Tags: eq, insert, on-conflict, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] common › insert with onConflict do nothing using composite pk as target (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2079
  - Tags: eq, insert, on-conflict, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] common › insert with onConflict do nothing using target (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2059
  - Tags: eq, insert, on-conflict, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] common › insert with onConflict do update (5 variants)
  - Flags: fixture=no, manual=yes
  - Sources: bun/bun-sql.test.ts:1468, pg/awsdatapi.test.ts:997, pg/pg-common.ts:1585, pg/pg-custom.test.ts:749, sqlite/sqlite-common.ts:2102
  - Tags: eq, insert, on-conflict, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] common › insert with onConflict do update using composite pk (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2149
  - Tags: eq, insert, on-conflict, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] common › insert with onConflict do update where (1 variants)
  - Flags: fixture=no, manual=yes
  - Sources: sqlite/sqlite-common.ts:2122
  - Tags: eq, insert, on-conflict, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.
- [ ] common › insert with onDuplicate (6 variants)
  - Flags: fixture=no, manual=yes
  - Sources: mysql/mysql-common.ts:1052, mysql/mysql-custom.test.ts:471, mysql/mysql-prefixed.test.ts:380, singlestore/singlestore-common.ts:1063, singlestore/singlestore-custom.test.ts:473, singlestore/singlestore-prefixed.test.ts:387
  - Tags: eq, insert, on-duplicate, select, where
  - Notes: Conflict/upsert semantics require Solid-specific design before parity implementation.

