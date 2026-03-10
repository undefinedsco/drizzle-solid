# Decision Record: <short-title>

- Status: `proposed | accepted | rejected | superseded`
- Area: `<modeling | core-api | query | migration | docs | skills | tooling | testing>`
- Date: `<YYYY-MM-DD>`
- Owners: `<maintainer(s)>`
- Related Issues: `<#123>`
- Related PRs: `<#456>`
- Supersedes: `<optional>`
- Superseded By: `<optional>`

## 1. Question

一句话写清楚：这个决策到底要解决什么问题？

## 2. Context

描述业务背景、用户场景、当前冲突，以及为什么不能继续模糊处理。

对于建模问题，优先写清：

- 这个概念想表达什么事实
- 这个事实属于哪个概念
- 预期支持哪些读写 / 查询方式
- 现有 docs / examples / skills 是否已经产生冲突

## 3. Constraints

列出会影响决策的边界条件，例如：

- Solid / RDF 语义限制
- Drizzle 迁移成本
- API 一致性
- backward compatibility
- 本地开发 / tooling 成本

## 4. Options Considered

至少列出被认真考虑过的候选方案。

### Option A — <name>

- Summary:
- Pros:
- Cons:
- Why not enough / why selected:

### Option B — <name>

- Summary:
- Pros:
- Cons:
- Why not enough / why selected:

## 5. Decision

写出当前正式采用的结论。

如果当前没有稳定结论，也可以明确写：

- 暂无共识
- 当前禁止把某个候选写成 README / examples / skills 的唯一推荐答案

## 6. Rationale

解释为什么选这个方案，而不是其他方案。

对于 `area:modeling`，建议显式回答：

- 为什么这个 predicate / IRI 更贴近概念语义
- 为什么其他候选不够准确
- 这是复用现有词汇，还是需要新术语

## 7. Consequences

说明采用该决策后的直接影响：

- 对 API / 类型 / 查询行为的影响
- 对迁移文档的影响
- 对 examples / tests / skills 的影响
- 对未来兼容性的影响

## 8. Rollout Checklist

- [ ] 更新 README / guides
- [ ] 更新 examples
- [ ] 更新 tests / regression
- [ ] 更新 skills
- [ ] 更新错误提示或 migration 文档
- [ ] 关闭或回链相关 issue / PR

## 9. Evidence / Provenance

这里记录结论来自哪里。

当前可以包括：

- 相关 issue / PR 讨论
- 维护者评审结论
- 例子、测试或实现验证
- 外部 vocabulary / spec 参考

未来如果接入 `consensus`，也可以把裁决输出贴在这里。
