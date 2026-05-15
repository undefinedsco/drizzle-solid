# Issue Handling Guidelines

在开始处理 issue 之前，先按 `docs/guides/issue-triage.md` 判断主归属：代码、文档、工具或决策。

本文档定义了处理用户报告的 Issue 的标准流程和最佳实践。

## Product semantics precedence

这份文档定义的是 **issue 处理流程**，不是仓库级产品语义来源。

规则是：

- issue / PR / 修复过程可以暴露问题
- 但跨 API 的执行语义、支持边界、建模口径，必须沉淀到 `docs/guides/decisions/`
- 当前 `exact-target 不退化` 的全局原则，以 `docs/guides/decisions/0001-keep-exact-target-paths-exact.md` 为准

因此，如果某个 issue 最终影响多个 API 路径，不要只在 issue 文档里解释，要补 decision record。

## Issue 分析流程

### 1. 理解问题和确认用户样例

在开始修复之前，必须完全理解问题：

- **仔细阅读** Issue 描述，包括所有评论和反馈
- **识别症状**：确切的错误信息或意外行为
- **理解用例**：用户试图实现什么功能
- **获取完整样例**：**必须**向用户确认完整的代码样例，包括：
  - 表结构定义（schema）
  - 查询代码
  - 期望结果 vs 实际结果
  - 错误信息（如果有）

**关键判断**：用户是用法错了还是我们有 bug？

#### 如果是用户用法错误：

1. **分析根本原因**：
   - 为什么用户会用错？
   - 是否因为文档不清晰或缺失？
   - 是否因为 API 设计不直观？
   - 是否因为错误提示不够明确？

2. **改进文档和错误提示**：
   - 如果文档不清晰，使用 **Context7** 维护文档：
     - 在 `docs/guides/` 添加或更新相关指南
     - 在 `examples/` 添加示例代码
     - 确保文档覆盖常见用例和易错点
     - **提交后自动同步到 Context7**（通过 GitHub Action）
     - 或手动在 https://context7.com 提交更新
   - 如果错误提示不清晰，改进错误信息：
     - 提供具体的错误原因
     - 给出修复建议（如："Add eq(table.chatId, value) to your where clause"）
     - 链接到相关文档

3. **考虑 API 改进**：
   - 如果多个用户犯同样的错误，考虑改进 API 设计
   - 添加更好的默认行为或类型检查

#### 如果是我们的 bug：

继续后续流程进行修复。

**反例**：看到错误信息就立即开始写代码修复

**正例**：先确认用户完整样例，判断是用法问题还是 bug，再决定修复方向

### 2. 重现问题并创建单测

**必须**基于用户的完整样例创建单测：

```typescript
// tests/integration/css/issue-N-description.test.ts
describe('Issue #N: Brief description', () => {
  it('should reproduce the exact user scenario', async () => {
    // 1. Setup: 使用用户提供的表结构
    const UserTable = podTable(/* 用户的 schema */);

    // 2. Execute: 执行用户的查询代码
    const result = await db.select()/* 用户的查询 */;

    // 3. Assert: 验证期望行为
    expect(result).toBe(/* 用户期望的结果 */);
  });
});
```

**关键要求**：
- 单测必须使用用户的**真实样例**，不要简化或修改
- 单测必须在 `tests/integration/css/` 中，使用真实 Pod 交互
- 单测必须**先失败**（重现问题），修复后**再通过**
- 单测必须在提交前**全部通过**

**流程**：
1. 创建单测，运行，验证失败（重现问题）
2. 实现修复
3. 运行单测，验证通过
4. 运行 `yarn quality`，确保没有回归
5. **只有在所有测试通过后才能提交**

### 3. 分析根本原因

深入代码找到问题的根源：

- **追踪调用栈**：从错误发生点向上追溯
- **理解设计意图**：为什么当前实现会失败
- **考虑边界情况**：是否影响其他场景
- **检查相关代码**：问题是否在其他地方也存在

**关键问题**：
- 这是设计问题还是实现 bug？
- 是否有其他用户也会遇到这个问题？
- 修复会影响现有功能吗？

### 4. 设计解决方案

提出修复方案前，考虑：

- **根本原因 vs 症状**：修复根本原因，不只是掩盖症状
- **向后兼容性**：是否会破坏现有用户代码
- **API 一致性**：是否符合 Drizzle ORM 的设计理念
- **权衡取舍**：性能、复杂度、用户体验

**多种方案时**：
- 在 Issue 中与用户讨论不同方案
- 说明每种方案的优缺点
- 让用户参与决策

### 5. 实现和测试

编写修复代码：

```typescript
// 1. 修复核心问题
// src/core/some-module.ts
export function fixedFunction() {
  // 清晰、专注的修改
  // 添加注释解释非显而易见的逻辑
}

// 2. 添加测试验证修复
// tests/integration/css/issue-N-description.test.ts
it('should work correctly after fix', async () => {
  // 验证修复解决了原始问题
});

it('should not break existing functionality', async () => {
  // 验证没有引入回归
});
```

**测试清单**：
- [ ] 原始问题已解决
- [ ] 相关功能没有回归
- [ ] 边界情况已覆盖
- [ ] `yarn quality` 全部通过

### 6. 文档、样例和沟通

完成修复后，按以下顺序进行：

#### 6.1 更新文档和样例

**使用 Context7 维护文档**：

1. **更新相关文档**（如果 API 有变化或需要澄清用法）：
   - `docs/guides/` - 添加或更新使用指南
   - `README.md` - 更新主要功能说明
   - API 文档 - 更新方法签名和说明

2. **添加或更新样例**：
   - `examples/` - 添加展示正确用法的示例
   - 确保样例能够编译和运行
   - 样例应该展示常见用例和最佳实践

3. **说明设计理念**（重要）：
   - 在文档中解释**为什么**这样设计
   - 说明设计权衡和考虑因素
   - 帮助用户理解系统的工作原理
   - 例如：
     ```markdown
     ## 设计理念：Multi-variable subjectTemplate

     drizzle-solid 支持多变量模板如 `{chatId}/messages.ttl#{id}`，
     这允许你按照 Solid 的容器层次结构组织数据。

     当查询时：
     - 如果提供完整 URI，系统直接使用（最高效）
     - 如果提供所有模板变量，系统解析完整路径
     - 如果只提供部分变量，系统会报错并提示缺少哪些变量

     这种设计确保了查询的明确性和性能。
     ```

#### 6.2 提交代码

- **添加代码注释**：解释复杂逻辑
- **提交信息**：引用 Issue 编号
  ```
  fix(resolver): support full URI in multi-variable template queries

  Fixes #4

  - Detect full URI vs base-relative resource id vs naked local id in document resolver
  - Provide clear error message when template variables are missing
  - Add integration test for full URI queries
  ```

#### 6.3 发布版本

- 更新版本号（遵循 semver）
- 更新 CHANGELOG.md 或 Release notes
- 发布到 npm

#### 6.4 回复 Issue

在 Issue 中回复，使用以下模板：

```markdown
Thanks for reporting this! I've fixed the issue and it will be available in version X.X.X.

**Problem**: [简要描述问题]

**Root Cause**: [技术解释为什么失败]

**Solution**: [我们如何修复的]

**Test Results**:
- ✅ Your exact scenario now works correctly
- ✅ All existing tests pass
- ✅ Added integration test to prevent regression

**Documentation**:
- Updated [link to doc] with usage examples
- Added example code in [link to example]

**Design Rationale**: [解释设计理念，帮助用户理解]

The fix is now available in version X.X.X. Please upgrade and let me know if it works for you!
```

#### 6.5 等待用户确认

**重要**：不要立即关闭 Issue

- 等待用户升级到新版本
- 等待用户确认问题已解决
- 如果用户在 3-5 天内没有回复，可以礼貌地询问
- **只有在用户确认问题修复后才关闭 Issue**

如果用户报告问题仍然存在：
- 重新分析问题
- 可能需要更多信息或不同的修复方案
- 保持 Issue 开放直到完全解决

## 常见问题模式

### 模式 1: Multi-variable subjectTemplate

**症状**：
```typescript
// 用户代码
const Message = podTable('Message', {
  id: string('id').primaryKey(),
  chatId: string('chatId'),
}, {
  subjectTemplate: '{chatId}/messages.ttl#{id}'
});

// 查询失败
await db.findById(Message, 'msg-123');
// Error: requires a base-relative resource id ... Missing [chatId]
```

**根本原因**：
- 模板需要 `{chatId}` 和 `{id}` 两个变量
- 用户只提供了局部 fragment，系统无法解析完整路径

**解决方案**：
1. 如果用户提供**完整 URI**（包含 `://`）：识别并直接使用
2. 如果用户提供**base-relative resource id**：正常解析路径
3. 如果用户提供**局部 fragment** 但缺少其他变量：抛出清晰的错误提示

**实现**：
```typescript
// 知道完整 IRI：走 findByIri()
await db.findByIri(Message, fullUri);

// 知道 base-relative resource id：走 findById()
await db.findById(Message, 'chat-1/messages.ttl#msg-123');

// 局部 fragment 不足以定位：抛出明确错误
await db.findById(Message, 'msg-123');
```

### 模式 2: FILTER on Optional Fields

**症状**：
```typescript
// 查询返回 0 结果，但数据确实存在
const threads = await db.select()
  .from(Thread)
  .where(eq(Thread.chatId, 'chat-1')); // chatId 是 optional 字段
// 返回 []，但实际有数据
```

**根本原因**：
- `chatId` 字段默认是 OPTIONAL
- SPARQL 生成：`OPTIONAL { ?subject <predicate> ?chatId } FILTER(?chatId = "chat-1")`
- 当 `?chatId` 未绑定时，FILTER 失败

**解决方案**：
将 WHERE 条件中引用的列从 OPTIONAL 提升为 required BGP

**实现**：
```typescript
// src/core/sparql/builder/select-builder.ts
const whereColumns = new Set<string>();
// 提取 WHERE 条件中引用的列
extractWhereColumns(ast.where);

// 将这些列标记为 required
if (column.options?.required || whereColumns.has(columnName)) {
  requiredTriples.push(triple);
} else {
  optionalTriples.push(triple);
}
```

### 模式 3: URI Link Resolution

**症状**：
```typescript
// uri() 字段查询失败
const Thread = podTable('Thread', {
  chatId: uri('chatId').link('Chat'), // 没有 .notNull()
});

await db.select().from(Thread).where(eq(Thread.chatId, 'chat-1'));
// 可能返回 0 结果
```

**根本原因**：
- uri 字段默认是 OPTIONAL
- 与模式 2 相同的 FILTER 问题

**解决方案**：
用户应该在 WHERE 条件中使用的 uri 字段上添加 `.notNull()`

**用户指导**：
```typescript
// 正确做法
const Thread = podTable('Thread', {
  chatId: uri('chatId').link('Chat').notNull(), // 添加 .notNull()
});
```

## Issue 回复模板

回复 Issue 时使用以下结构：

```markdown
Thanks for reporting this! I've fixed the issue and it will be available in version X.X.X.

**Problem**: [简要描述问题]

**Root Cause**: [技术解释为什么失败]

**Solution**: [我们如何修复的]

**Test Results**:
- ✅ Your exact scenario now works correctly
- ✅ All existing tests pass
- ✅ Added integration test to prevent regression

**Documentation**:
- Updated [link to doc] with usage examples
- Added example code in [link to example]

**Design Rationale**: [解释设计理念，帮助用户理解为什么这样设计]

The fix is now available in version X.X.X. Please upgrade and let me know if it works for you!
```

## 关闭 Issue 前的完整检查清单

**代码和测试**：
- [ ] 确认用户完整样例（schema + 查询代码 + 期望结果）
- [ ] 判断是用户用法错误还是我们的 bug
- [ ] 如果是用法错误，分析为什么会用错（文档？API 设计？错误提示？）
- [ ] 基于用户真实样例创建单测
- [ ] 单测先失败（重现问题）
- [ ] 实现修复
- [ ] 单测通过
- [ ] 所有相关测试通过（`yarn quality`）

**文档和样例**（使用 Context7 维护）：
- [ ] 更新或添加相关文档（`docs/guides/`）
- [ ] 添加或更新示例代码（`examples/`）
- [ ] 在文档中说明设计理念和权衡
- [ ] 改进错误提示（如果适用）

**发布和沟通**：
- [ ] 提交代码，引用 Issue 编号
- [ ] 发布新版本到 npm
- [ ] 更新 CHANGELOG 或 Release notes
- [ ] 在 Issue 中回复，说明修复和设计理念
- [ ] **等待用户确认问题已解决**
- [ ] **只有在用户确认后才关闭 Issue**

## 完整流程图

```
1. 收到 Issue
   ↓
2. 确认用户完整样例（schema + 查询 + 期望结果）
   ↓
3. 判断：用法错误 or bug？
   ↓
   ├─ 用法错误 → 分析为什么会用错
   │              ├─ 文档不清晰？→ 使用 Context7 更新文档
   │              ├─ API 不直观？→ 考虑改进 API
   │              └─ 错误提示不清晰？→ 改进错误信息
   │
   └─ 我们的 bug → 继续修复流程
                    ↓
4. 基于用户真实样例创建单测（必须先失败）
   ↓
5. 分析根本原因
   ↓
6. 设计解决方案
   ↓
7. 实现修复
   ↓
8. 单测通过 + yarn quality 通过
   ↓
9. 使用 Context7 更新文档和样例
   ├─ 更新 docs/guides/
   ├─ 添加 examples/
   └─ 说明设计理念
   ↓
10. 提交代码（引用 Issue 编号）
    ↓
11. 发布新版本
    ↓
12. 在 Issue 中回复（包含设计理念说明）
    ↓
13. 等待用户确认
    ↓
14. 用户确认后关闭 Issue
```

## Issue #4 案例分析

### 问题描述

用户报告了两个相关问题：
1. 使用多变量模板时，仅通过 id 查询会抛出错误
2. 在 optional uri 字段上使用 WHERE 条件返回 0 结果

### 完整分析过程

#### 1. 确认用户样例

用户提供的场景：
```typescript
// 表结构
const Message = podTable('Message', {
  id: string('id').primaryKey(),
  chatId: string('chatId'),
  content: string('content'),
}, {
  subjectTemplate: '{chatId}/messages.ttl#{id}'
});

// 查询代码
const message = await db.findByIri(
  Message,
  'http://.../chat-1/messages.ttl#msg-123',
);

// 期望：返回 1 条记录
// 实际：抛出错误 "missing required variable(s) [chatId]"
```

#### 2. 判断：用法错误 or bug？

**分析**：
- 用户提供了**完整 URI**，包含了所有信息（chatId 和 id）
- 系统却要求额外提供 chatId 变量
- **结论**：这是我们的 bug，系统应该识别完整 URI

**如果是用法错误的情况**：
假设用户这样写：
```typescript
// 只提供局部 fragment，没有提供完整 base-relative resource id
await db.findById(Message, 'msg-123');
```

这种情况下：
- **为什么会用错**：用户可能不理解多变量模板需要所有变量
- **文档问题**：我们的文档没有清楚说明多变量模板的查询要求
- **改进方案**：
  1. 使用 Context7 在 `docs/guides/` 添加多变量模板指南
  2. 改进错误提示，明确告诉用户缺少哪些变量
  3. 在 `examples/` 添加多变量模板的正确用法示例

#### 3. 创建单测（基于用户真实样例）

```typescript
// tests/integration/css/issue-4-multi-variable-template.test.ts
describe('Issue #4: Multi-variable template queries', () => {
  it('should work with full URI (user exact scenario)', async () => {
    // 使用用户的真实表结构
    const Message = podTable('Message', {
      id: string('id').primaryKey(),
      chatId: string('chatId').predicate('http://example.org/chatId'),
      content: string('content').predicate(SCHEMA.name),
    }, {
      base: `${containerUrl}messages/`,
      type: 'http://example.org/Message',
      subjectTemplate: '{chatId}/messages.ttl#{id}',
    });

    const client = pod(session, { schema: { Message } });

    const db = client.asDrizzle();

    // 插入测试数据
    await db.insert(Message).values({
      id: 'msg-123',
      chatId: 'chat-1',
      content: 'Test Message',
    });

    // 用户的查询代码（完整 URI）
    const fullUri = `${containerUrl}messages/chat-1/messages.ttl#msg-123`;
    const message = await db.findByIri(Message, fullUri);

    // 用户期望的结果
    expect(message).not.toBeNull();
    expect(message?.content).toBe('Test Message');
  });

  it('should throw clear error with local fragment id (edge case)', async () => {
    // 测试边界情况：局部 fragment 缺少分区
    await expect(async () => {
      await db.findById(Message, 'msg-123'); // 局部 fragment，缺少 chatId 分区
    }).rejects.toThrow(/requires a base-relative resource id.*chatId/);
  });
});
```

**运行单测**：
```bash
$ npx vitest tests/integration/css/issue-4-multi-variable-template.test.ts
# 第一次运行：FAIL（重现问题）
# Error: missing required variable(s) [chatId]
```

#### 4. 根本原因分析

追踪代码发现：
- `document-resolver.ts` 第 107 行检查模板变量
- 没有区分局部 fragment、base-relative resource id 和完整 URI
- 对于完整 URI，所有信息已经在 URI 中，不需要额外变量

#### 5. 设计解决方案

**方案**：
1. 检查 id 是否是完整 URI（包含 `://`）
2. 如果是完整 URI，直接使用
3. 如果是 base-relative resource id，直接按 base 解析
4. 如果只是局部 fragment 且缺少分区信息，抛出清晰错误

**设计理念**：
- 支持明确的查询方式（完整 URI 或 base-relative resource id）
- 完整 URI 查询最高效（直接定位资源）
- 局部 fragment 在多变量模板下不是完整 id（确保查询明确性）
- 错误提示清晰，告诉用户如何修复

#### 6. 实现修复

```typescript
// src/core/resource-resolver/document-resolver.ts
if (idValues.length > 0 && !allVarsPresent) {
  const idValue = idValues[0];
  const isFullUri = idValue.includes('://') || idValue.startsWith('http');

  if (isFullUri) {
    // Full URI provided - can resolve directly
    return [this.getResourceUrlForSubject(idValue)];
  }

  // Naked local id provided but missing template variables - error
  const missing = requiredVars.filter(v => !(v in templateValues));
  throw new Error(
    `Cannot resolve subjectTemplate '${template}': ` +
    `missing required variable(s) [${missing.join(', ')}]. ` +
    `Add eq(table.${missing[0]}, value) to your where clause.`
  );
}
```

#### 7. 测试验证

```bash
$ npx vitest tests/integration/css/issue-4-multi-variable-template.test.ts
# ✅ should work with full URI (user exact scenario) - PASS
# ✅ should throw clear error with naked local id - PASS

$ yarn quality
# ✅ All tests pass
# ✅ No regressions
```

#### 8. 使用 Context7 更新文档和样例

**更新文档** (`docs/guides/multi-variable-templates.md`)：
```markdown
# Multi-variable subjectTemplate

## 设计理念

drizzle-solid 支持多变量模板如 `{chatId}/messages.ttl#{id}`，
这允许你按照 Solid 的容器层次结构组织数据。

## 查询方式

### 方式 1: 使用完整 URI（推荐，最高效）

当你知道完整 URI 时，直接使用：

\`\`\`typescript
const fullUri = 'http://pod.example/messages/chat-1/messages.ttl#msg-123';
const message = await db.findByIri(Message, fullUri);
\`\`\`

系统会直接定位到该资源，无需扫描容器。

### 方式 2: 使用 base-relative resource id

如果没有完整 IRI，需要提供相对 `base` 的完整资源 id：

\`\`\`typescript
const message = await db.findById(Message, 'chat-1/messages.ttl#msg-123');
\`\`\`

系统会解析完整路径并查询。

### 错误情况：只提供局部 fragment

\`\`\`typescript
// ❌ 错误：缺少 chatId 变量
await db.findById(Message, 'msg-123');

// Error: findById requires a base-relative resource id ...
// Missing [chatId].
\`\`\`

## 为什么这样设计？

1. **明确性**：要求所有变量确保查询意图明确
2. **性能**：完整 URI 查询最快，直接定位资源
3. **安全性**：避免意外的全容器扫描
```

**添加示例** (`examples/04-multi-variable-templates.ts`)：
```typescript
// 展示多变量模板的正确用法
// 包含完整 IRI 和 base-relative resource id 两种方式
```

#### 9. 提交和发布

```bash
$ git add src/core/resource-resolver/document-resolver.ts \
         tests/integration/css/issue-4-multi-variable-template.test.ts \
         docs/guides/multi-variable-templates.md \
         examples/04-multi-variable-templates.ts

$ git commit -m "fix(resolver): support full URI in multi-variable template queries

Fixes #4

- Detect full URI vs base-relative resource id vs naked local id in document resolver
- Provide clear error message when template variables are missing
- Add integration test for user's exact scenario
- Add documentation explaining design rationale
- Add example code for multi-variable templates"

$ yarn build
$ npm version patch  # 0.2.10 -> 0.2.11
$ npm publish
$ git push origin main --tags
```

#### 10. 回复 Issue

```markdown
Thanks for reporting this! I've fixed the issue and it's now available in version 0.2.11.

**Problem**: When querying with a full URI on a multi-variable template, the system incorrectly required all template variables to be provided separately.

**Root Cause**: The document resolver didn't distinguish between full URIs, base-relative resource ids, and naked local ids. It always checked for template variables, even when the full URI already contained all the information.

**Solution**:
- Added detection for full URIs (containing `://`)
- When a full URI is provided, use it directly without requiring template variables
- When a naked local id is provided without all storage slots, throw a clear error with guidance

**Test Results**:
- ✅ Your exact scenario now works correctly
- ✅ All existing tests pass
- ✅ Added integration test based on your code to prevent regression

**Documentation**:
- Added [Multi-variable Templates Guide](docs/guides/multi-variable-templates.md)
- Added [example code](examples/04-multi-variable-templates.ts) showing both query methods
- Updated error messages to be more helpful

**Design Rationale**:
We support two query methods for flexibility:
1. **Full URI** (recommended): Most efficient, directly locates the resource
2. **Short id + all variables**: System resolves the full path

This design ensures query clarity and performance while preventing accidental full-container scans.

The fix is now available in version 0.2.11. Please upgrade and let me know if it works for you!

\`\`\`bash
npm install drizzle-solid@0.2.11
\`\`\`
```

#### 11. 等待用户确认

- 用户升级到 0.2.11
- 用户测试并回复："Works perfectly! Thanks for the quick fix and clear documentation."
- **现在可以关闭 Issue**

### 经验教训

1. **必须确认用户完整样例**：避免误解需求
2. **判断用法错误 vs bug**：不同的处理方式
3. **基于真实样例创建单测**：确保修复真正有效
4. **使用 Context7 维护文档**：保持文档同步和质量
5. **说明设计理念**：帮助用户理解系统
6. **等待用户确认**：确保问题真正解决
7. **改进错误提示**：让用户能够自助解决问题
