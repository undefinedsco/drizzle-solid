# Decision Record: require-complete-join-locator-for-multi-variable-templates

- Status: `accepted`
- Area: `query`
- Date: `2026-03-16`
- Owners: `maintainers`
- Related Issues: `n/a`
- Related PRs: `n/a`
- Supersedes: `n/a`
- Superseded By: `n/a`

## 1. Question

当 join 的右表使用多变量 `subjectTemplate` 时，是否允许只靠局部 `id` 退化成扫描式查找？

## 2. Context

这份决策是 `0001-keep-exact-target-paths-exact.md` 在多变量 join 上的具体应用。

`drizzle-solid` 支持类似 `{chatId}/messages.ttl#{id}` 这样的多变量模板。

这类模板的 `id` 只在给定 locator 上下文里才可解析。也就是说：

- `msg-1` 本身不等于完整资源位置
- 真正的定位信息是 `chatId + id`
- 或者直接给出完整 IRI

如果 join 只给右表 `id`，而缺少其他模板变量，系统并不知道该去哪个分区 / 文档查找目标。

过去的一个候选方向是：在 pushdown 失败后退化成扫描式 join。但这会把“无法精确定位”的问题掩盖成运行时扫描行为，导致：

- 性能不可预测
- 行为不透明
- 不同数据规模下结果质量和成本漂移
- 用户继续沿用 SQL 中“只拿外键 id 就能 join 一切”的错误迁移心智

## 3. Constraints

- Solid 中资源位置由 `base + subjectTemplate` 决定，不是抽象 SQL 主键定位
- 多变量模板天然带有物理分区语义
- `0001-keep-exact-target-paths-exact.md` 已要求 exact-target 路径不能静默扩成 scan
- 因此多变量 join 的右表定位也必须遵守相同规则

## 4. Options Considered

### Option A — 缺 locator 时退化成扫描式 join

- Summary: 先尝试按 `id` 精确查；失败后扫描容器 / 子容器，再做内存 join
- Pros:
  - 某些用户样例看起来“还能跑”
- Cons:
  - 性能不可预测
  - 行为高度依赖数据分布
  - 会把 under-specified query 伪装成 supported behavior
  - 与全局 exact-target 原则相矛盾
- Why not enough / why selected:
  - 不采用

### Option B — 要么完整 locator，要么直接失败

- Summary: 对多变量模板右表，join 若想按 `id` 定位，必须同时提供所有必需模板变量，或使用完整 IRI
- Pros:
  - 规则清晰
  - 语义稳定
  - 成本可预测
  - 迫使调用方显式建模 locator
- Cons:
  - 相比 SQL 迁移更严格
  - 需要用户在 schema / relation 设计上多想一步
- Why not enough / why selected:
  - 采用

## 5. Decision

仓库正式采用以下口径：

- 多变量 `subjectTemplate` 的右表 join，不允许在 locator 不完整时隐式退化成扫描式 join
- 如果右表按 `id` 定位还需要其他模板变量，则 join 条件必须显式提供这些变量
- 如果调用方已经持有完整 IRI，也可以直接基于完整 IRI join
- 无法精确定位时，应直接报错，并提示补齐 locator 或改为 full IRI

## 6. Rationale

这条规则把多变量模板当成真正的物理定位语义，而不是实现细节。

一旦 `subjectTemplate` 把实体分布到不同文档 / 子容器里，`id` 就不再是全局可解析身份。继续假装它像 SQL 主键一样可全局 join，只会制造“表面兼容、实则不稳定”的行为。

因此，系统应优先：

1. 明确表达“你缺了哪部分 locator”
2. 给出可执行的修复建议
3. 避免偷偷降级为扫描

## 7. Consequences

- 对查询行为：
  - join 右表为多变量模板时，缺 locator 将抛出明确错误
  - 提供完整 locator 后，系统按精确条件执行，不再依赖扫描 fallback
- 对迁移文档：
  - 需要明确 SQL foreign-key `id` 心智不能直接照搬
- 对 examples / tests / skills：
  - 必须补齐“完整 locator join”与“缺 locator 报错”的示例与回归
- 对未来兼容性：
  - 如果以后引入显式的宽松模式，也必须作为 opt-in，而不是默认行为

## 8. Rollout Checklist

- [x] 更新 README / guides
- [x] 更新 examples
- [x] 更新 tests / regression
- [x] 更新 skills
- [x] 更新错误提示或 migration 文档
- [ ] 关闭或回链相关 issue / PR

## 9. Evidence / Provenance

- 维护者对多变量模板 join 语义的收口讨论
- 已有 multi-variable template error contract
- 本次新增 / 调整的 unit 与 integration regression
- `0001-keep-exact-target-paths-exact.md`
