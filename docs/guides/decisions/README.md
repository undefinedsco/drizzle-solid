# Decision Records

这组文档用来沉淀 `drizzle-solid` 的稳定决策，尤其是：

- `kind:decision`
- 仓库级执行语义原则
- `area:modeling`
- 支持边界
- API 口径
- public skills 依赖的规则

这些文档是仓库级语义来源。

- issue / PR 评论负责讨论与收敛
- `docs/guides/issue-handling.md` 负责修复流程
- 但跨 API、跨文档、跨 skills 的稳定规则，必须落在这里

## 什么时候写 decision record

满足以下任一条件，就不要只停留在 issue 评论里：

- 需要明确“支不支持”
- 需要明确某个建模语义或 predicate / IRI 选择
- 需要明确 README / docs / examples / skills 的统一口径
- 需要把未来 PR 都遵守的规则固定下来

## 当前建议

- 提问阶段：用 issue 模板收集问题
- 讨论阶段：在 issue / PR 中收敛候选方案
- 落盘阶段：用 `TEMPLATE.md` 生成 decision record
- 发布阶段：把结论同步到 docs / examples / skills

## 层级建议

优先按“全局原则 → 特例应用”组织：

- 先写仓库级原则，例如 exact-target / collection 的边界
- 再写某个 area 的具体化，例如多变量 join、某个建模规则、某个 API 支持边界

不要反过来让 issue 文档或单个 case 文档承担全局语义定义。

## 状态建议

推荐使用以下状态：

- `proposed`：问题已成型，待定案
- `accepted`：当前仓库采用的正式口径
- `rejected`：明确不采用
- `superseded`：被后续决策替代

## 文件命名建议

建议用：

- `0001-short-title.md`
- `0002-modeling-chat-workspace.md`
- `0003-remove-tosql-surface.md`

编号保证可排序；标题保证可读。

## 当前已接受决策

- `0001-keep-exact-target-paths-exact.md` — exact-target 路径必须保持精确，或显式失败
- `0002-require-complete-join-locator-for-multi-variable-templates.md` — 多变量 join 是上面原则在 join 场景下的具体化

## 建模类决策的额外要求

对于 `area:modeling`：

- 单个 AI 的答案只算提案
- 如果存在多种合理 ontology 解释，不要伪装成已经定论
- 允许记录“暂无共识”
- 只有稳定结论才能回写到 public skills

相关指南：`docs/guides/modeling-consensus.md`
