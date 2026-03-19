# Decision Record: keep-exact-target-paths-exact

- Status: `accepted`
- Area: `core-api`
- Date: `2026-03-17`
- Owners: `maintainers`
- Related Issues: `n/a`
- Related PRs: `n/a`
- Supersedes: `n/a`
- Superseded By: `n/a`

## 1. Question

当某条 API 路径的语义已经是在表达 exact target 时，是否允许执行器在信息不足或优化失败时静默扩成 collection scan？

## 2. Context

`drizzle-solid` 同时支持两类看起来相似、但语义完全不同的路径：

- collection-oriented read
- exact-target resolution

前者本来就是在受控范围内枚举、过滤、扫描集合；后者则是在表达“我要这个具体 target”。

如果系统把 exact-target 路径静默扩成 scan，会出现几个根问题：

- 调用方写的是精确语义，运行时执行的是集合语义
- 成本和性能从可预测变成依赖数据分布
- 用户无法判断哪些代码是真正的 exact target，哪些只是碰巧扫出来
- Drizzle/SQL 的迁移心智会继续把 under-specified query 误当成 supported behavior

这不是单个 issue 的局部修复策略，而是仓库级执行语义边界。

## 3. Constraints

- Solid 中 target 是否可精确定位，取决于 `IRI`、`base`、`subjectTemplate` 和 locator 信息
- `collection.list()` 这类 API 本来就允许集合级读取，不应被误伤
- 用户需要清楚区分“显式 collection read”与“精确 target”
- 如果以后提供宽松模式，也必须是显式 opt-in，而不是默认行为

## 4. Options Considered

### Option A — exact-target 不够精确时自动扩成 scan

- Summary: 只要库还能想办法把结果扫出来，就允许从 exact-target 路径自动降级
- Pros:
  - 某些历史样例表面上更容易“跑起来”
  - 用户短期内少写一些 locator / IRI
- Cons:
  - API 语义不可信
  - 性能和正确性依赖数据规模与布局
  - 错误迁移心智会被保留
  - 后续优化和回归判断没有稳定基线
- Why not enough / why selected:
  - 不采用

### Option B — exact-target 要么保持精确，要么显式失败

- Summary: 当 API 已经进入 exact-target 语义时，执行器只能走精确解析；信息不足就直接报错
- Pros:
  - 规则统一
  - 语义透明
  - 成本可预测
  - 便于文档、测试、skills 和 future API 一致收口
- Cons:
  - 对迁移用户更严格
  - 需要调用方显式提供 locator / IRI
- Why not enough / why selected:
  - 采用

## 5. Decision

仓库正式采用以下全局原则：

- collection-oriented 路径可以做显式集合读取、过滤和受控扫描
- 但 exact-target 路径必须保持 exact，或者显式失败
- 不允许把 exact-target 路径静默扩成 collection scan
- 任何宽松模式如果未来存在，也必须作为明确 opt-in，而不是默认行为

这条规则适用于所有当前和未来的 exact-target 语义路径，而不只是 mutation 或某个特定 issue。

## 6. Rationale

`drizzle-solid` 最核心的不是 API 名字，而是语义边界是否稳定。

只要调用方已经在表达：

- 某个确定实体
- 某个确定 subject
- 某个确定 join target
- 某个确定 mutation target

系统就不该再擅自把它解释成“那我去扫一遍集合试试看”。

否则所谓 exact-target 只是表面命名，不是可依赖的执行契约。

## 7. Consequences

- 对 API 设计：
  - 未来任何 exact-target surface 都必须先回答“缺信息时怎么显式失败”
- 对查询行为：
  - join、mutation、entity 读取等路径都应遵守这条规则
- 对文档结构：
  - 这类跨 API 的支持边界必须写入 decision records，而不是只留在 issue 文档里
- 对 issue 流程：
  - issue 可以暴露问题，但不能充当仓库级语义来源
- 对测试：
  - 执行路径回归应验证“保持 exact”或“显式失败”，而不是默认允许 widened scan

## 8. Rollout Checklist

- [x] 更新 README / guides
- [x] 更新 examples
- [x] 更新 tests / regression
- [x] 更新 skills
- [x] 更新错误提示或 migration 文档
- [ ] 关闭或回链相关 issue / PR

## 9. Evidence / Provenance

- 维护者对 exact-target / collection-oriented 语义边界的收口讨论
- 已有 mutation 口径与多变量模板 join 回归
- `0002-require-complete-join-locator-for-multi-variable-templates.md` 作为该原则在 join 上的具体化
