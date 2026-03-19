# Progress

## Issue Audit

当前仓库里，能够从本地文档、提交历史、测试命名中明确对齐到的问题，先按下面这张表管理。

| Issue | Kind | Area | Status | Stable asset |
| --- | --- | --- | --- | --- |
| `#3` SPARQL endpoint with deep subdirectories | `code` | `query` | fixed | `tests/integration/css/sparql-deep-subdirs.test.ts` |
| `#4-A` multi-variable template query by full URI | `code` | `query` | fixed | `tests/integration/css/issue-4-multi-variable-template.test.ts`, `tests/unit/core/resource-resolver/resolver.test.ts` |
| `#4-B` FILTER on optional/link fields | `code` | `query` | fixed | `tests/integration/css/filter-optional-fields.test.ts` |
| CSS investigation 1: N3 Patch integer literal delete mismatch | `tooling/upstream` | `ldp` | mitigated with regression coverage, not closed upstream | `tests/integration/css/ldp-update-regression.test.ts`, `docs/investigations/css-issues-report.md`, `src/core/execution/ldp-executor.ts` |
| CSS investigation 2: concurrent PATCH -> SQLITE_ERROR` | `tooling/upstream` | `ldp` | mitigated with regression coverage, not closed upstream | `tests/integration/css/ldp-update-regression.test.ts`, `docs/investigations/css-issues-report.md`, `src/core/execution/ldp-executor.ts` |

## Current judgement

- `kind:code` 的已知问题里，当前明确对齐到的 `#3`、`#4` 已经都有回归测试。
- `#4` 现在拆成两个可验证子问题管理：
  - 完整 URI + 多变量模板查询
  - optional/link 字段上的 FILTER
- CSS 调查文档里的两个问题更接近 `kind:tooling` / 上游兼容性问题，不该冒充“库内代码 issue 已完全关闭”。
- 适配器侧已补上 `tests/integration/css/ldp-update-regression.test.ts`，用于防止现有缓解策略回退。

## Remaining gaps

- 还没有一份完整的 GitHub issue -> 仓库资产映射表；当前只能根据本地文档和提交历史恢复。
- 后续新增 issue 必须按 `docs/guides/issue-triage.md` 先分型，再决定落测试、文档还是工具修复。
