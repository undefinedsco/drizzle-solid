# Decision Record: per-database-select-endpoint-binding

- Status: `accepted`
- Area: `core-api`
- Date: `2026-10-25`
- Owners: `maintainers`
- Related Issues: `#13`
- Related PRs: `n/a`
- Supersedes: `n/a`
- Superseded By: `n/a`

## 1. Question

当同一份共享 `podTable`（例如跨房间复用的 models 资源）需要按房间读取时，collection SELECT 的
SPARQL endpoint 应该绑在哪里——全局可变表状态，还是每个 DB 实例？

## 2. Context

Solid 房间/协作容器的真实布局里：

- 文档写入已经是 per-room 的规范 LDP 路径（`.../matrix-abc/index.ttl`、`.../matrix-abc/2026/10/25/messages.ttl`）
- exact-by-IRI 读取已经指向具体文档
- 但 collection SELECT 会走 `table.getSparqlEndpoint()`，而那是**共享表的可变量**

已发布 0.3.20 / 0.3.25 的实测 URL 探针（见 issue #13 与
`.test-data/matrix-room-binding-probe/`）确认：

- `db.select().from(chatResource)` → `.../.data/chat/-/sparql`（较宽的全局端点）
- `db.findById(...)` → `.../.data/chat/matrix-abc/index.ttl`（正确的具体文档）
- 在 DB config 里传未声明的 `sparqlEndpoint` 会被静默忽略

调用方（LinX/Xpod）被授权的是某个房间容器，而不是创建者的整个个人根；因此它们需要一个
**不修改共享模型、不复制 schema、不改变 canonical IRI/布局** 的按房间端点绑定。

直接调用 `table.setSparqlEndpoint(...)` 是共享单例的全局变更，会让并发房间互相串线。

## 3. Constraints

- 共享 `podTable` 对象可能同时被多个 DB 实例使用，任何绑定都不能写回表
- 不能改变 canonical RDF IRI、exact-target 文档路径、LDP 写入目标
- 缺省行为必须与今天完全一致
- 显式窄端点被拒绝或不可用时必须 fail closed，不能回退到更宽的全局端点或 container walk
- 库负责路由；调用方（应用适配层）负责验证房间授权，库不发明权限或 actor
- 不新增多余 config flag、批量 API 框架或布局变更

## 4. Options Considered

### Option A — 可变的表级 endpoint（现状）

- Summary: 继续使用 `table.sparqlEndpoint`，调用方按房间 `setSparqlEndpoint`
- Pros: 零新增 API
- Cons: 共享单例全局变更；并发房间互相覆盖；需要复制 schema 才能隔离
- Why not enough / why selected: 不采用

### Option B — 每个 DB 实例的可选 `sparqlEndpoint` 绑定（采用）

- Summary: `drizzle(session, { sparqlEndpoint })`，字符串或 `(table) => string | undefined`，
  仅用于该 DB 实例的 collection SELECT
- Pros: 不改共享表；两个 DB 并发天然隔离；优先于表默认端点；缺省行为不变；
  可与现有 `podUrl` / room-container DB 组合
- Cons: 新增一个公开配置项，需要文档说明其精确作用域
- Why not enough / why selected: 采用

### Option C — 每个查询传 endpoint

- Summary: `db.select().from(table, { sparqlEndpoint })`
- Pros: 粒度最细
- Cons: API 面更大；`findMany`/builder/plan/executor 多处透传；调用方通常一个 DB 服务一个房间
- Why not enough / why selected: 不在本次窄修复内；Option B 已覆盖当前缺口

## 5. Decision

仓库正式采用 **Option B**：

- `SolidDrizzleConfig` / `PodDialectConfig` 新增可选 `sparqlEndpoint?: string | SparqlEndpointResolver`
- 作用域是**该 DB 实例的 collection SELECT**
- 优先级高于 `table.getSparqlEndpoint()`；resolver 返回 `undefined` 时保留该表原有行为
- 相对路径按该 DB 的 Pod URL 解析；非 http(s) 或空绑定直接报错（fail closed）
- exact-by-IRI 读取仍指向具体文档（绑定只作为执行来源，不改变文档 URL）
- 该规则覆盖真实 builder 路径：`whereByIri()` 生成的 `BinaryExpression`、`findByIri` 的精确回退，
  以及 update/delete `returning()` 的精确预读，都必须落到具体文档
- 精确识别只接受 RDF 主语操作数：canonical `@id` 或**本表**别名限定 `<baseAlias>.@id`；
  普通列名即使以 `@id` 结尾（`external@id` 等）也不算主语，`IN`、范围或与其它谓词组合的条件属于集合查询
- 裸 where 对象必须恰好只有一个 `@id` 键才算精确；带额外键按集合查询
- 只有 SELECT 求值 resolver；INSERT/UPDATE/DELETE 从不求值，写入路由保持基线行为
- 带显式绑定的 SELECT 不修改共享表任何状态（endpoint/base/subjectTemplate），并跳过会改动表的自动发现
- 协议相对绑定（`//host/...`）直接拒绝
- INSERT/UPDATE/DELETE 继续走 LDP，目标不变
- 启用绑定时，自动 TypeIndex/SPARQL 发现不再把发现的端点写回共享表；resolver 拒绝某张表时，
  该表仍保留原有发现行为
- resolver 每个 SELECT 操作只求值一次，结果以 `BoundSelectEndpointResolution` 传递，
  “已解析为 undefined”不会被当作“未解析”二次求值
- join 两侧各自按本表 resolver 结果路由（已绑定/未绑定可混合），不引入多源框架

## 6. Rationale

房间授权是**每个 DB/会话**的事实，不是共享 schema 的事实。把绑定放在 DB 配置上：

- 共享 `podTable` 保持不可变，模型层无需复制或修改
- 并发房间隔离来自对象边界，而不是时序约定
- fail-closed 规则与 `0001-keep-exact-target-paths-exact.md` 一致：宁可报错，不静默放宽
- 没有引入新 flag 家族；一个可选字段即可表达

## 7. Consequences

- 对 API：新增一个可选字段，向后兼容
- 对查询：collection SELECT 可被收窄；exact/写入语义不变
- 对文档：`docs/guides/sparql-mode-design.md` 增加 per-DB 绑定章节
- 对测试：新增单测 + 真实 CSS/xpod 集成回归
- 对迁移：未设置该字段时行为与 0.3.x 完全一致

## 8. Rollout Checklist

- [x] 更新 README / guides
- [ ] 更新 examples
- [x] 更新 tests / regression
- [ ] 更新 skills
- [x] 更新错误提示或 migration 文档
- [ ] 关闭或回链相关 issue / PR

## 9. Evidence / Provenance

- Issue #13（真实录制 URL 探针，发布版 0.3.20 / 0.3.25）
- `docs/guides/decisions/0001-keep-exact-target-paths-exact.md`
- `tests/unit/core/pod-dialect-bound-endpoint.test.ts`
- `tests/integration/css/issue-13-room-scoped-select.test.ts`（真实 CSS/xpod，无 fetch mock）
- `tests/unit/core/pod-dialect-exact-builder.test.ts`（真实 `whereByIri()` builder + 最终 source URL）
- `tests/unit/core/pod-dialect-mixed-join-binding.test.ts`（混合 join 绑定范围）
