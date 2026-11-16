# Decision Record: directory-resource-collection-reads-metadata-facet

- Status: `proposed` (ORM-side implemented; server capability unpublished and separately owned)
- Area: `core-api`
- Date: `2026-11-16`
- Owners: `maintainers`
- Related Issues: `#16` (linked `xpod#208`, LinX#68)
- Related PRs: `n/a`
- Supersedes: `n/a`
- Superseded By: `n/a`

## 1. Question

当一个 `podTable` 的 id 布局以 `/` 结尾（每条记录本身是一个 LDP container，即
"directory resource"）时，collection SELECT 应该如何读到该资源自己的 RDF？当前实现把
`?subject ?p ?o` 发到 un-named / data graph，容器文档里只有 containment triples，资源自身
的 RDF 存在服务器管理的 `.meta` auxiliary 里（named graph `meta:{resourceIRI}`），因此
collection SELECT 恒为 0 行。

问题不是"要不要给普通查询偷偷并上 metadata"，而是：**哪种查询形状可以显式、受限地声明
"我要读这些 directory resource 的 metadata facet"，同时完全保留 ordinary default dataset
与 exact-target 语义。**

## 2. Context

- 共享 `@undefineds.co/models` 的 `agentResource` 形如 `base: '/agents/'`、
  `id: id('id').default('{key}/')`、`type: foaf:Agent`，并要求 `createdAt`/`updatedAt`。
- 真实 Pod（self-boot Xpod + CSS）上：
  - `GET /agents/{key}/` 是容器文档，只有 `ldp:contains`。
  - `PATCH /agents/{key}/.meta`（`application/sparql-update`）返回 205；app 自有的
    `dcterms:created` 可写，服务器自有的 `dcterms:modified` 由客户端写入会 409。
  - `GET .meta` 与 exact `findById`/`findByIri` 正常。
  - `select().from(agentResource)` 走 `/agents/-/sparql`，发 un-named BGP，返回 0 行。
- `agentRepository.create` 会 EISDIR；这是写入 API 的既有限制，不在本决策范围。
- 真实 LinX 期望回归：`apps/web/src/lib/data/agent-home.integration.test.ts` 的
  "fresh real collection contains the newly created Agent with required fields"（intentionally RED）。
- 后端归属：xpod#208 由 xpod read-path worker 修复；本仓库只负责 ORM 侧的 generic
  resolver/strategy/builder 边界。

## 3. Constraints

- 不能改共享 Models/schema、不能复制 schema、不能按 Agent/provider 身份分支。
- 不给 ordinary SELECT 增加隐式 metadata union，不改 endpoint `scopedUnion` 默认数据集。
- exact-target API（`findById`/`findByIri`/`whereByIri`）保持 exact，不退化成 collection scan
  （见 `0001-keep-exact-target-paths-exact.md`）。
- ordinary document SELECT/join/multivalue/order/limit 语义不变。
- collection 读必须在**不知道 resource ID** 的前提下、在一次 SPARQL 请求内发现行；不能用
  "客户端先列子资源再逐个精确绑定 metadata graph"的隐藏枚举。
- graph 必须绑定到同一个 subject；否则同一 `meta:` 命名空间里关于其他 IRI 的 metadata
  不能变成这一行。
- 实现口径（Root wire decision）：唯一 canonical 形状是 query-level
  `FILTER(STRSTARTS(STR(?metadataGraph), "meta:{collectionBase}"))` +
  `FILTER(STR(?subject) = STRAFTER(STR(?metadataGraph), "meta:"))`。
- 历史说明：frozen xpod 0.3.71 的 public router 会对 GRAPH 变量的 STR/STRAFTER 返回
  "String FILTER arguments must be literals"；那只是旧 server 的缺口。修复后的 native backend
  已由 Xpod worker 实测支持 STR/STRSTARTS/STRAFTER。ORM 早期使用的
  `BIND(IRI(CONCAT(...)))` + term-equality 只是旧 runtime 的临时 workaround，已移除。

## 4. Options Considered

### Option A — 普通查询默认并上 metadata（implicit union）

- Summary: 让 `/agents/-/sparql` 的 un-named 查询同时命中 data graph 与 `meta:` graph。
- Pros: 客户端零改动。
- Cons: 改变默认数据集语义；普通文档查询会意外看到 auxiliary triples；无法区分
  "own facet" 与 foreign metadata；写入/ACL 边界模糊。
- Why not enough / why selected: 不采用。

### Option B — 客户端枚举子容器后逐个 exact metadata 读

- Summary: 先 `ldp:contains` 列 `/agents/`，再对每个 `.meta` 精确读取。
- Pros: 不依赖后端新形状。
- Cons: 隐藏的 N+1 扫描；order/limit 语义无法在服务端成立；随规模线性放大；与
  "collection SELECT 是一次查询"的既有契约冲突。
- Why not enough / why selected: 不采用。

### Option C — 显式 GRAPH 变量 + 有界 metadata 命名空间 + graph↔subject 绑定

- Summary: collection SELECT 生成
  `GRAPH ?metadataGraph { ... }`，用 `STRSTARTS(STR(?metadataGraph), "meta:{collectionBase}")`
  限定命名空间，并用 `FILTER(STR(?subject) = STRAFTER(STR(?metadataGraph), "meta:"))`
  在查询内（先于 ORDER BY/LIMIT/OFFSET）绑定 graph 与 subject；ORM 保留客户端 row guard
  作为第二道正确性边界。
- Pros:
  - 显式：只有 directory-resource collection 读走这条路径。
  - 有界：命名空间来自表自己的 canonical collection base，与 endpoint 同源。
  - 不猜 ID：一次请求内由 `GRAPH ?metadataGraph` 发现行。
  - 不 widening：exact-target 与 ordinary document 路径不变。
  - 引擎可执行：已用真实 Comunica 与真实 Pod 探针验证 `STRSTARTS` 与 `BIND`+term equality。
- Cons:
  - 依赖后端接受 metadata 命名空间的显式读（xpod#208）。
  - 需要一次跨仓库 contract（见下）。
- Why not enough / why selected: 采用。

## 5. Decision

- "directory-resource layout" 只由现有 id 布局决定：显式 `subjectTemplate` 或 id 列 default
  以 `/` 结尾（且不以 `#` 开头）。不引入新的 schema 字段，不看 `type`/`config.name`/provider。
- 该判断收敛在 `src/core/resource-resolver/directory-layout.ts`，并通过
  `ResourceResolver.resolveDirectoryMetadataLayout(table, collectionBaseIri)` 暴露。
- 只有 SPARQL collection SELECT（非 exactResource）会绑定显式 metadata graph。
- 生成形状固定为：
  ```
  GRAPH ?metadataGraph { <generated collection BGP> }
  FILTER(STRSTARTS(STR(?metadataGraph), "meta:<canonicalCollectionBase>"))
  FILTER(STR(?subject) = STRAFTER(STR(?metadataGraph), "meta:"))
  ```
  并投影 `?metadataGraph`。变量名是结构性的：server 侧必须从 GRAPH + namespace filter +
  binding filter 推导 subject/graph 变量，不得依赖字面 `?resource` / `?metadataGraph`。
- 查询内绑定先于 `ORDER BY`/`LIMIT`/`OFFSET`；客户端 row guard 只做二次校验，不作为
  唯一过滤。
- 结果行只在 `metadataGraph === 'meta:' + subject` 且 graph 处于该命名空间时保留。
- ordinary document SELECT、join、multi-value、order、limit、distinct 与 exact-target 读取不变。
- 该决策不引入写入 API、不改变 `.meta` 写入保护（`dcterms:modified` 409 保持）。

## 6. Rationale

- 读语义必须显式：调用方写 `select().from(table)` 时，README/Models 已经声明这是
  directory resource；把这个事实编码进查询形状，比在服务端做隐式 union 更容易审计。
- 不猜 ID 是硬约束：collection 读的输入里没有 resource IRI，任何需要先知道 ID 的方案
  都会退化成客户端扫描。
- graph↔subject 绑定必须在查询内完成：只在客户端 post-filter 会让 foreign row 参与
  `ORDER BY`/`LIMIT`，真实场景下会返回空集合（已在集成测试与决策文档中记录）。
- 只改一个 canonical boundary，避免 Agent 特例污染 ORM。

## 7. Consequences

- 对 API：无新公开 API；`select().from(directoryTable)` 在支持的后端上返回行，而不是 0 行。
- 对执行：directory-table collection SELECT 的 SPARQL 文本会包含 `GRAPH ?metadataGraph`
  与两个 FILTER/BIND；其他查询文本不变。
- 对后端：需要 xpod 接受有界 metadata 命名空间的显式 graph 变量读，并按 source resource
  授权（xpod#208）。ORM 侧 contract 与 xpod contract 需保持同一形状。
- 对测试：
  - 单测覆盖分类、SPARQL 形状、查询内绑定顺序、真实 Comunica 执行、行 guard。
  - 集成测试覆盖真实 Pod：control（explicit `GRAPH <meta:...>`）、desired collection、
    fresh client、exact `findByIri`、ordinary document 控制。
- 对文档：README/Examples 在根因关闭前不宣称已支持；本决策保持 `proposed` 直到后端契约落地。

## 7a. Aggregate / GROUP BY 规则

`?metadataGraph` 只用于"这一行来自该资源自己的 facet"校验。它**不能**被投影进
grouped/aggregate 查询：

- SPARQL 要求投影变量必须出现在 `GROUP BY` 中或被聚合，否则引擎报
  `Projection of ungrouped variable (?metadataGraph)`。
- 把 `?metadataGraph` 加进 `GROUP BY` 是**错误修复**：它会把同一分组按 graph 拆开，
  改变公共聚合结果（例如同名不同 agent 会被计成 1 而不是 2）。

采用的规则：

- own-facet 相关性仍然保留在 `WHERE`（`GRAPH ?metadataGraph` + 命名空间过滤 +
  `STR(?subject) = STRAFTER(...)`），因此在分组/排序/limit 之前就已经限定为本资源的
  metadata。
- grouped/aggregate plan 不投影 `?metadataGraph`；`SPARQLQuery.metadataGraphVariable`
  只在该变量确实被投影时设置，strategy 的 row guard 据此跳过聚合行（聚合行天然没有
  graph/subject 绑定，不能丢弃）。
- Pod-side reader 要求投影 graph 变量，因此 directory 表的 grouped/aggregate 查询走
  **既有 client-side aggregate fallback**（从已相关过滤的 own-facet 行在 JS 聚合）。
  这保持了空 `COUNT` 为 0 与公共聚合形状，且不改 group partitions。
- ordinary（非 directory）表的 aggregate 仍走 SPARQL `GROUP BY`，行为不变。

## 7b. 版本与发布口径

- 本补丁随 `0.3.27` 作为普通 patch 发布（仓库既有惯例：feature/fix commit 内直接 bump
  `package.json`，无独立 `CHANGELOG.md`）。
- `0.3.26` 已发布且不得复用/覆盖。
- 服务端 metadata facet read（xpod#208）仍是**未发布的独立后端能力**；本库在缺少该能力时
  行为保持不变（普通查询不并 metadata），不声称生产已修复。

## 8. Rollout Checklist

- [x] 单测：classification / builder / strategy / real Comunica，以及 aggregate/GROUP BY 回归
- [x] 真实耦合 Pod 集成：CLOUD/PG17 fixture 上显式 GRAPH + collection + 跨 agent 去重聚合均通过
- [x] README / guides：本 decision record 已记录服务端能力依赖与聚合规则
- [ ] 服务端 metadata read 能力发布（xpod#208，另行拥有，未发布）
- [ ] LinX#68 客户端回归翻绿（依赖服务端能力发布）
- [ ] 关闭或回链 issue #16 / xpod#208

## 9. Evidence / Provenance

- Issue: <https://github.com/undefinedsco/drizzle-solid/issues/16>（linked xpod#208、LinX#68）
- LinX 期望回归：`/Users/gbb/develop/.worktrees/linx-column-restore-rc53/apps/web/src/lib/data/agent-home.integration.test.ts`
- 既有证据：`REVIEW-REPORT.json`（`agent-metadata-regression-root-review`）
- 旧 frozen runtime 实测（private out，`directory-select-frozen-deps/probe-evidence.json`）：
  - `GRAPH <meta:...>` 在该 0.3.71 端点返回 0 行；
  - `GRAPH ?g` 只列出 data graph；
  - `STR(?g)`/`STRAFTER(STR(?g))` 在 FILTER 中 400（旧 server 缺口）；
  - `STRSTARTS(STR(?g), "meta:")` 可用。
- 修复后 native backend（Xpod worker 实测）支持 STR/STRSTARTS/STRAFTER；canonical 形状因此
  不再需要 BIND workaround。
- 耦合 CLOUD/PG17 fixture（Root 持有 gateway `127.0.0.1:51000`，PostgresRdfEngine 17.12）：
  - 显式 `GRAPH <meta:...>`、directory collection、跨 agent 去重 `COUNT`/`COUNT(*)` 通过；
  - `?metadataGraph` 不再被投影进 grouped 计划，own-facet 相关性保留在 WHERE；
  - 聚合走既有 client-side aggregate fallback（服务端要求投影 graph 变量，这与 SPARQL
    `GROUP BY` 合法性不可兼得；不因此引入新的 native 聚合要求）。
- 私有输出目录：`directory-select-frozen-deps/`、`directory-select-current-pg-joint/`、
  `directory-select-aggregate-review-fix/`。
