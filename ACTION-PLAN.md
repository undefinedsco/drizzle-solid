# 测试实施行动计划

> 历史 / 执行记录说明：本文件用于 backlog、阶段进展与执行记录，不是当前测试规范。
>
> 当前唯一正式测试口径见 `docs/guides/testing.md`。如本文件与维护中的测试、README 或指南冲突，以 `docs/guides/testing.md` 为准。

## 📊 当前进展 (2026-03-07)

### 已产出的 parity 测试集

| 测试文件 | 测试数量 | 当前状态 | 覆盖内容 |
|---------|---------:|------|---------|
| `tests/integration/css/drizzle-crud.test.ts` | 24 | ✅ 已产出 / ✅ 已编译 | CRUD 操作，3 种存储模式 |
| `tests/integration/css/drizzle-operators.test.ts` | 29 | ✅ 已产出 / ✅ 已编译 | 查询操作符、复杂条件、char update/delete |
| `tests/integration/css/drizzle-features.test.ts` | 18 | ✅ 已产出 / ✅ 已编译 | 排序、分页、distinct、组合查询 |
| `tests/integration/css/drizzle-aggregations.test.ts` | 19 | ✅ 已产出 / ✅ 已编译 | count/sum/avg/min/max、groupBy、having、distinct、null 语义 |
| `tests/integration/css/drizzle-joins.test.ts` | 14 | ✅ 已产出 / ✅ 已编译 | LEFT/INNER/CROSS JOIN、alias self-join、flat/grouped/table projection、aliased filter、unmatched row、deferred limit 语义 |
| `tests/integration/css/drizzle-batch.test.ts` | 6 | ✅ 已产出 / ✅ 已编译 | 顺序 batch insert/update/delete/select + returning |
| `tests/integration/css/drizzle-mapped.test.ts` | 4 | ✅ 已产出 / ✅ 已编译 | 模板映射样例冒烟 |
| `tests/integration/css/drizzle-complex-crud.test.ts` | 4 | ✅ 已产出 / ✅ 已编译 | 复杂逻辑更新/删除 |
| `tests/integration/css/drizzle-types.test.ts` | 13 | ✅ 已产出 / ✅ 已编译 | scalar/default/date/time/array/object/bigint parity |
| `tests/integration/css/drizzle-query-api.test.ts` | 6 | ✅ 已产出 / ✅ 已编译 | `db.query.*` facade、`findMany/findFirst/findById/count/with` |
| `tests/integration/css/drizzle-raw-sparql.test.ts` | 1 | ✅ 已产出 / ✅ 已编译 | `db.execute()` raw SPARQL SELECT escape hatch |
| `tests/integration/css/drizzle-returning.test.ts` | 6 | ✅ 已产出 / ✅ 已编译 | `insert/update/delete returning()` all/partial parity |
| `tests/integration/css/drizzle-exists.test.ts` | 2 | ✅ 已产出 / ✅ 已编译 | raw SPARQL graph-pattern `exists/notExists` 过滤 |
| `tests/integration/css/smart-generated.test.ts` | 6 | ✅ 已产出 / ✅ 已编译 | 生成测试收敛版核心场景 |
| `tests/integration/css/template-matrix.test.ts` | 2 | ✅ 已产出 / ✅ 已编译 | 模板矩阵核心 roundtrip |
| **总计** | **154** | **✅ 代码已落地** | **Drizzle parity 核心测试集已继续扩展** |

> 以上数量按 `test()/it()` 静态计数得到，用于跟踪“已产出测试”的规模；不等同于当天真实 CSS 环境下的运行结果。

### 当天验证状态（2026-03-07）

- ✅ `./node_modules/.bin/tsc -p tsconfig.jest.json --pretty false --noEmit` 已通过
- ✅ `yarn vitest --run tests/unit/core/query-builder-exists.test.ts tests/unit/core/query-builder-to-sql.test.ts tests/unit/core/select-aggregate-distinct.test.ts tests/unit/core/select-having.test.ts tests/unit/core/table-alias.test.ts tests/unit/core/select-cross-join.test.ts tests/unit/core/mutation-returning.test.ts tests/unit/core/pod-database-execute.test.ts tests/unit/core/pod-dialect-execute-sparql.test.ts` 已通过（37 tests）
- ⏳ `http://localhost:5739` 当前不可用，**今天尚未完成**真实 CSS 回归
- ⏳ 因此当前可确认的是“测试文件已生成并通过 TypeScript 编译 + 关键 unit 护栏通过”，不是“真实运行全绿”

### 本轮新增强化

- `tests/integration/css/drizzle-types.test.ts`
  - 修正 `and(...)` 的 import
  - 已覆盖 default / overridden default / bigint / timezone / empty array / object-array 等 parity 行为
- `tests/integration/css/drizzle-aggregations.test.ts`
  - 由弱断言改为精确断言
  - 新增 `groupBy + count/sum/avg`、`having(({ total }) => ...)`、`count(distinct ...)`、`sum/avg(distinct ...)`、null-only 聚合语义、mixed aggregate 错误语义
- `tests/integration/css/drizzle-joins.test.ts`
  - 由“存在即可”改为精确结果断言
  - 新增 unmatched row 保留、flat projection、joined-table `where`、deterministic `orderBy + limit`
  - 新增 `crossJoin` 笛卡尔积、`projection + limit`、grouped/table projection、aliased filter 与 `alias()` self-join parity 用例
- `src/core/query-builders/select-query-builder.ts`
  - 新增 `crossJoin()` builder API
  - 修复 join 结果在 deferred projection / inline hydration 阶段被按 subject 二次合并的问题
  - 修复 join projection 在同名列场景下错误回落到裸列名的问题
  - 新增 structured selection fallback，支持 grouped object / whole-table projection
- `tests/integration/css/drizzle-batch.test.ts`
  - 新增 `batch + returning()` 与 `batch + delete returning()` parity 用例
- `tests/integration/css/drizzle-query-api.test.ts`
  - 新增 `db.query.<table>` 集成覆盖
  - 已覆盖 `findMany / findFirst / findById / findByIRI / count / with`
- `src/core/pod-database.ts`
  - 新增 `db.execute(sparql)` 与 `db.executeSPARQL(sparql)` 公共入口
  - `db.execute()` 明确沿用 SPARQL 主线，不承诺 raw SQL
  - 已补 `tests/unit/core/pod-database-execute.test.ts` 护栏
- `src/core/pod-dialect.ts`
  - `executeSPARQL()` 改为自动识别 `SELECT / ASK / INSERT / DELETE / UPDATE`
  - 新增明显 raw SQL 文本拒绝护栏，避免把 SQL 误当 SPARQL 执行
  - 已补 `tests/unit/core/pod-dialect-execute-sparql.test.ts` 护栏
- `tests/integration/css/drizzle-raw-sparql.test.ts`
  - 新增 raw SPARQL SELECT 集成用例
  - 当前先覆盖最小 escape hatch，不把 raw SQL 作为主线能力
- `src/core/query-builders/insert-query-builder.ts` / `src/core/query-builders/update-query-builder.ts` / `src/core/query-builders/delete-query-builder.ts`
  - 新增 Solid 语义版 `returning()`
  - 支持 `returning()` 与 `returning({ ...partial })`，暂不支持 raw SQL mutation + returning
- `tests/unit/core/mutation-returning.test.ts`
  - 已补 insert/update/delete `returning()` 单测
  - 已补 raw SQL mutation + `returning()` 护栏单测
- `tests/unit/core/select-cross-join.test.ts`
  - 已补 `crossJoin()` 笛卡尔积与 anti-collapse 单测
- `src/core/schema/pod-table.ts` / `src/index.ts`
  - 新增公开 `alias(table, aliasName)` 能力，用于 self-join / alias projection
- `tests/unit/core/table-alias.test.ts`
  - 已补 `alias()` 表克隆、self-join、grouped projection 与 whole-table projection 护栏
- `src/core/query-builders/select-query-builder.ts`
  - 新增 `having()` builder API
  - 对 grouped aggregate + join 场景启用 JS fallback，支持按 selected alias 过滤
  - non-join `having()` 在执行侧仍以稳妥路径优先，但导出侧已支持生成原生 `HAVING` SPARQL
- `src/core/query-builders/select-query-builder.ts` / `src/core/query-builders/insert-query-builder.ts` / `src/core/query-builders/update-query-builder.ts` / `src/core/query-builders/delete-query-builder.ts`
  - 新增 builder 级 `toSPARQL()` / `toSparql()` 原生导出
  - 当前 select `toSPARQL()` 已支持非-join、非-structured selection 查询；其中 non-join `HAVING` 可导出为原生 SPARQL
- `tests/unit/core/query-builder-to-sql.test.ts`
  - 已补 `select/insert/update/delete toSPARQL()` 护栏；`JOIN` / structured-selection 仍保留 unsupported 护栏，non-join `HAVING` 已转为正向生成测试
- `tests/unit/core/select-having.test.ts`
  - 已补 grouped aggregate `having()` 与 join + aggregate fallback 单测
- `src/core/sparql/builder/select-builder.ts` / `src/core/select-plan.ts`
  - 已接通 non-join `having()` 的 `SelectQueryPlan -> SPARQL` 转换链路
  - `toSPARQL()` 现可导出带 `HAVING` 的 grouped aggregate 查询
- `tests/unit/core/select-aggregate-distinct.test.ts`
  - 已补 pure aggregate JS fallback 对 `count/sum/avg/min/max(distinct ...)` 的护栏
- `tests/unit/core/query-builder-exists.test.ts`
  - 已补 raw graph-pattern `exists/notExists` 的 SPARQL 生成护栏
- `tests/integration/css/drizzle-exists.test.ts`
  - 新增 raw SPARQL graph-pattern `exists/notExists` 集成测试
  - 先落 Solid 语义，不直接承诺 Drizzle 风格 correlated subquery builder
- `README.md`
  - 已明确：原生能力是 SPARQL；公开导出只保留 `toSPARQL()` / `toSparql()`，raw escape hatch 主线是 SPARQL
- `tests/integration/css/drizzle-returning.test.ts`
  - 新增 insert/update/delete `returning()` 集成测试
  - 覆盖 all-fields / partial projection 两档语义

### 当前未闭环项

- 真实 CSS 回归待环境恢复后执行：
  - `./node_modules/.bin/vitest --run tests/integration/css/drizzle-*.test.ts --no-file-parallelism`
- 仍属于 `adapted/investigate` 且**当前 API 未完全覆盖**的上游 case：
  - lateral join
  - SPARQL 主线下的表达式扩展（例如 `groupBy(sql...)` 这类兼容层入口是否映射到 SPARQL）
  - correlated `exists` subquery builder / prepared / cte 等专项

---

## 🎯 样例挑选标准

### 核心原则

1. **优先迁移价值，不追求机械搬运**
   - 只优先挑选用户从 Drizzle 迁移到 Solid 时，最常写、最需要保持心智一致的公开 API 行为。
   - 典型包括：`select / insert / update / delete / where / orderBy / limit / offset`。

2. **优先真实可执行，不保留纸面兼容**
   - 样例必须能在真实 CSS / Pod 上稳定执行。
   - 不为了“看起来像上游”而保留依赖 SQL 引擎特性的测试壳。

3. **优先行为单元，不按方言重复堆量**
   - 上游同一行为在 pg/mysql/sqlite 等多个方言重复出现时，只保留一份代表性 parity case。
   - 我们按“行为语义”去重，不按“来源文件数量”计数。

4. **优先 API 表面，不直接继承 SQL 引擎语义**
   - 对 `transaction`、`auto-increment`、`view/index/foreign key`、driver/version 校验这类 SQL/驱动专属能力，默认不直接捡。
   - 对 `batch`、`query-api`、correlated `exists`、`prepared/cte` 这类，需要先确认 Solid 语义，再决定是否保留。
   - 不再保留 `toSQL()` 兼容层；新增能力优先落在 SPARQL 主线上。

5. **先保证可维护，再扩展覆盖面**
   - 新样例必须有清晰 fixture、稳定断言、明确目标文件。
   - 不能自动生成成品时，就进入 `adapted` / `investigate` 队列，而不是产出不可执行占位测试。

### 分级标准

- `direct / P0`
  - 可直接映射到 Solid 的公开 API 行为
  - 通常不需要复杂 fixture 和手工改写断言
  - 例如：CRUD、`where`、`orderBy`、`limit`、`offset`

- `adapted / P1`
  - 有明确迁移价值，但必须换成 Solid 风格 fixture / 断言
  - 例如：`join`、`aggregation`、`groupBy`、`distinct`

- `investigate / P2-P3`
  - API 名字相近，但语义、执行路径或断言方式还没完全定型
  - 例如：`batch`、`query-api`、correlated `exists`、`returning`、`prepared`、`cte`

- `skip / P3`
  - SQL 引擎专属、驱动专属或基础设施专属，不属于当前 Solid parity 表面
  - 例如：`transaction`、`auto-increment`、`view`、`index`、`foreign key`、version/import 校验

### 决策口径

**能直接捡的样例**：
- 公开 API 稳定
- Solid 上有明确等价行为
- 能在真实 Pod 上用稳定 fixture 复现
- 断言不依赖 SQL 行为细节

**需要改写后再捡的样例**：
- 样例本身有价值，但依赖多资源布局、RDF 存储模式、URI 模板或 Solid 查询限制
- 断言必须从“SQL 结果集形状”调整为“Solid 资源行为”

**暂时不捡的样例**：
- 只是 SQL 数据库能力，不是 Drizzle 公共 API 迁移价值
- 需要事务/约束/引擎保证才能成立
- 现阶段只能生成占位壳，不能形成可执行测试

---

## 🧭 当前实施流程

1. 使用 `scripts/generate-drizzle-parity.ts` 扫描上游 Drizzle 集成测试
2. 生成 `tests/fixtures/drizzle-parity/queue.json` 作为主实施队列
3. 同步生成：
   - `tests/fixtures/drizzle-parity/boards/*.todo.md` 作为人工排期看板
   - `tests/integration/css/generated-parity/*.parity.todo.test.ts` 作为可运行的 `test.todo()` 骨架
4. 按以下顺序推进：
   - `direct / P0`
   - `adapted / P1`
   - `investigate / P2`
5. 每实现一批，就回归真实 CSS 测试
6. 把 `test.todo()` / 占位壳持续收敛成真正可维护的集成测试

---

## 📦 当前优先范围

### 已收敛完成
- Core CRUD parity
- Operator parity
- Feature parity（排序/分页）
- Aggregation parity
- Join parity
- Batch 首轮顺序语义
- 模板映射样例
- 生成测试收敛版（smart/template matrix）

### 下一步建议
- `query-api` / `findMany` / `findFirst` 的 parity 策略
- correlated `exists` / `groupBy(sql...)` / `distinct` 更细分的行为覆盖
- `returning`、`prepared`、`cte` 是否进入 investigate 专项
- 把“挑样例标准”继续下沉到生成脚本规则，减少后续人工筛选成本

---

## ▶️ 常用命令

```bash
# 重新生成 parity 队列
./node_modules/.bin/ts-node --transpile-only scripts/generate-drizzle-parity.ts

# 跑 Drizzle parity 核心集
./node_modules/.bin/vitest --run tests/integration/css/drizzle-*.test.ts --no-file-parallelism

# 跑生成测试收敛集
./node_modules/.bin/vitest --run tests/integration/css/smart-generated.test.ts tests/integration/css/template-matrix.test.ts --no-file-parallelism

# 跑当前总回归
./node_modules/.bin/vitest --run tests/integration/css/drizzle-*.test.ts tests/integration/css/smart-generated.test.ts tests/integration/css/template-matrix.test.ts --no-file-parallelism
```
