# Decision Records

这组文档用来沉淀 `drizzle-solid` 的稳定决策，尤其是：

- `kind:decision`
- `area:modeling`
- 支持边界
- API 口径
- public skills 依赖的规则

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

## 建模类决策的额外要求

对于 `area:modeling`：

- 单个 AI 的答案只算提案
- 如果存在多种合理 ontology 解释，不要伪装成已经定论
- 允许记录“暂无共识”
- 只有稳定结论才能回写到 public skills

相关指南：`docs/guides/modeling-consensus.md`
