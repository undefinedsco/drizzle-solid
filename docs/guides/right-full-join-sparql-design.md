# rightJoin/fullJoin 与 SPARQL Endpoint 直连设计方案

## 背景
Drizzle Solid 当前通过 `SelectQueryBuilder` 暴露 Drizzle 风格的 `join` API，并在 `PodDialect` 中把查询转换为 SPARQL。由于缺乏原生的 `rightJoin` / `fullJoin` 生成逻辑，我们现阶段直接抛错并回退到内存级联结，既不符合 Drizzle 的语义，也限制了复杂查询的覆盖范围。同时，所有表都会经过 LDP 的 `HEAD`/`PUT` 探测流程，这在仅暴露 SPARQL 端点的服务（如 Comunica standalone、Blazegraph）上会触发 `401/405`，导致无法复用现有的 CRUD 能力。

## 目标
- **Drizzle 对齐**：提供与上游一致的 `rightJoin` / `fullJoin` API 体验与结果语义。
- **Solid 实测**：在 CSS/Comunica 环境下执行真实的 SPARQL 查询，避免非必要的内存回放。
- **Endpoint 兼容**：允许针对纯 SPARQL 端点跳过 LDP 校验，仍保留插入、更新、删除能力。
- **测试可证明**：配套单元与集成测试，确保两条特性线的行为可回归。

## 工作范围
- 扩展 `SelectQueryBuilder`、`ASTToSPARQLConverter` 和 join fallback，完整支持 `rightJoin` / `fullJoin`。
- 为纯 SPARQL 端点提供新的访问模式配置，调整 `PodDialect` 的执行分支与错误处理。
- 更新 README Roadmap 与相关文档，帮助使用者理解特性状态。

## 方案总览

### 1. 支持 `rightJoin` / `fullJoin`

#### 当前行为
- `SelectQueryBuilder.addJoin` 在 `rightJoin`、`fullJoin` 上直接抛出 `is not yet supported`。
- `PodDialect` 虽然能够在 `operation.joins` 中看到 join 元数据，但 `ASTToSPARQLConverter` 目前只针对 left/inner 输出 `OPTIONAL` 模式，其他类型会触发内存回放。
- 现有 `mergeRowsWithJoin` 仅实现了 left/inner 的合并逻辑，无法恢复 `right`/`full` 语义。

#### 设计要点
- **查询构建器扩展**：
  - 移除 `addJoin` 中针对 `rightJoin`/`fullJoin` 的防卫异常，沿用既有 `JoinType` 枚举。
  - 为 join 结果引入 `JoinPlan`（类型定义位于 `select-plan.ts`），包含 join 别名、条件列表、过滤器等信息，确保 `PodDialect` 可传递完整上下文。
  - 调整 `resolveJoinConditions`，在多字段等值时生成稳定的 join 键序列，为后续结果去重提供基础。
- **SPARQL 生成**：
  - 在 `ASTToSPARQLConverter` 中实现 `buildJoinPatterns`，根据 join 类型输出不同的 graph pattern。
    - `leftJoin`：保持当前 `OPTIONAL { ... }` 实现。
    - `rightJoin`：将右表 pattern 作为主体，在 `OPTIONAL` 中嵌入左表 pattern，并通过 `BIND`/`COALESCE` 映射别名，使左表缺失时返回 `NULL`。
    - `fullJoin`：构建 `UNION` 的双分支 —— 左表主导的 left join 与右表主导的 right join。第二分支需要 `FILTER(!BOUND(?left_key))` 避免重复。
  - 为 join 生成的变量采用 `?{alias}_{column}` 命名，保证 union 两侧变量一致。
- **执行器集成**：
  - `PodDialect.query` 组装 `operation.joins` 时填充 `JoinPlan`，并在调用 `sparqlConverter.convertSelect` 时传入。
  - 默认情况下直接执行生成的 SPARQL，只有当转换器检测到不支持的 on 条件（如非等值、复杂表达式）时，才退回 `applyJoinFallback`。
- **回放策略补齐**：
  - 在 `mergeRowsWithJoin` 中补充 `rightJoin`：遍历 join 表结果集，基于 join 键关联主表数据，未命中时填充 `null`。
  - 为 `fullJoin` 合并左右集合并以 join 键进行去重；优先保留左表记录，再合并右表独有值。
  - 更新 `normalizeJoinRows` 与 `normalizeBaseRows`，确保右表字段也带上 `{alias}.{column}` 键。
- **边界条件**：
  - 对 `groupBy`、`distinct` 场景，确保 union 分支在转换后仍能对应同一选择列。
  - 在 `offset/limit` 情况下，于转换层通过子查询包裹或记录序列表达式，保证结果数量可控。

#### 验证计划
- **单元测试**：
  - `SelectQueryBuilder`：断言 `rightJoin`、`fullJoin` 能生成预期的 `JoinPlan`。
  - `ASTToSPARQLConverter`：对不同 join 类型 snapshot SPARQL 输出，覆盖多字段等值与 `groupBy`。
- **集成测试**：
  - 在 `tests/integration/css` 新增 right/full join 场景，验证缺失一侧时返回 `null`。
  - 针对 fallback 分支构造特例（如 ON 包含表达式），确认仍能得到正确结果。
- **性能验证**：
  - 通过 `yarn dev` 检查生成的 SPARQL，并在 CSS + Comunica v2 上执行，确保无额外错误日志。

#### 风险与缓解
- **UNION 结果集放大**：限制 `fullJoin` 的原生转换仅支持等值条件，其他情况提示回退；必要时在转换器中插入 `DISTINCT`。
- **别名碰撞**：扩展 `aliasUsage` 计数器，在 union 分支中自动重命名冲突别名。
- **Comunica 支持度**：保留 fallback 路径，并在执行器中对 `UNION` 失败输出 `WARN`，同时记录 issue 供后续跟进。

### 2. 纯 SPARQL Endpoint 直连模式

#### 当前行为
- `resolveTableUrls` 会将 `containerPath` 解析为 LDP 资源路径并附加 `.ttl`。
- `query` 在执行 `select/update/delete` 前统一调用 `ensureContainerExists` / `ensureResourceExists` / `resourceExists`（`HEAD`/`PUT`/`GET`），导致纯 SPARQL 端点报错。
- 所有 `sparqlExecutor` 请求都以 Pod URL 为数据源，无法针对第三方端点进行区分。

#### 设计要点
- **配置扩展**（已实现）：
  - 为 `PodTableOptions` 增加 `accessMode?: 'ldp' | 'sparql'`（默认 `'ldp'`）与 `sparqlEndpoint?: string`, `defaultGraph?: string`。
  - 在 `podTable` 构造时记录新配置，并在 `PodDialect` 初始化时允许注册多个 SPARQL 数据源。
- **执行路径调整**（已实现）：
  - 当 `accessMode === 'sparql'` 时，`resolveTableUrls` 直接返回端点 URL，不再拼接 `.ttl`。
  - `query` 根据 accessMode 决定是否跳过 LDP 校验流程；端点模式下直接构建 `SPARQLQuery` 并调用 `sparqlExecutor.executeQuery`。
  - `INSERT`/`UPDATE`/`DELETE` 使用 `ASTToSPARQLConverter` 输出完整 SPARQL UPDATE，并通过端点执行（不再走 PATCH）。
  - 在 executor 中新增 `registerSparqlEndpoint`，把端点 URL 与可选的 `defaultGraph` 注册到 `sources`。
- **错误处理**：
  - 捕获 401/405/415 等响应并返回带上下文的错误信息；在日志中脱敏 `Authorization` header。
  - 对短暂网络错误（`ECONNRESET` 等）在 fetch 包装层重试一次。
- **兼容性**：
  - 表级别支持混合模式，同一 `PodDialect` 可以同时操作 Pod 和纯 SPARQL 端点。
  - 为保持向后兼容，若开发者未显式设置 `accessMode`，行为保持不变（仍按 LDP 模式）。

#### 验证计划
- **单元/集成测试（已覆盖）**：
  - `resolveTableUrls` 根据 accessMode 返回正确的 URL。
  - `PodDialect.query` 在 `'sparql'` 模式下跳过 LDP 校验流程，直接走端点执行。
  - `sparqlExecutor` 针对端点模式发起 SPARQL UPDATE 请求。
- **集成测试**：
  - 在 `tests/integration/css` 新增针对远程 SPARQL 端点的 CRUD 流程，验证不再触发 HEAD/PUT。
  - 在 `.env.local` 中记录端点所需的 `SOLID_SPARQL_ENDPOINT`，并在测试说明中列出前置条件。
- **文档更新**：
  - 更新 `docs/quick-start-local.md` & `docs/guides` 示例，说明如何声明端点模式。
  - README Roadmap 链接本设计方案，提示后续版本安排。

#### 风险与缓解
- **缺乏事务语义**：端点模式暂不保证 ACID，在文档中标注限制并提醒使用者。
- **多数据源管理**：当端点和 Pod 混用时，需要在 executor 中区分 source 类型；计划在实现阶段为 `sources` 数组增加结构化描述。
- **安全性**：避免在日志中输出端点凭证，对错误信息进行脱敏处理。

## 里程碑与交付物
- **Milestone 1 – Join 支持基础设施**：完成查询构建器与转换器改造，补齐 join fallback，并新增单测/集成测试。
- **Milestone 2 – SPARQL Endpoint 模式**：实现配置与执行分支，补齐自动化测试与错误处理。
- **Milestone 3 – 文档与示例清理**：更新 README Roadmap、快速开始与示例脚本，记录迁移说明。

## 依赖与未决问题
- Comunica v2 对含 `UNION` + `OPTIONAL` 的查询性能需在真实 Pod 中验证。
- 是否需要为端点模式暴露 `dataset`/`graph` 选择器，有待社区反馈。
- 一旦 CSS 支持原生 full join，可在转换器中引入 feature flag，切换回服务端执行路径。
