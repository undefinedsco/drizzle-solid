# Mode Matrix - 模式组合矩阵

## 维度

### 1. Resource Mode (资源模式)
- **fragment**: `base: '/data/tags.ttl'` → URI 格式 `resource.ttl#id`
- **document**: `base: '/data/users/'` → URI 格式 `container/id.ttl`

### 2. ID Predicate (ID 谓词)
- **@id (virtual)**: `id()` → 从 subject URI 提取
- **custom predicate**: `string('id').predicate('schema:identifier')` → 作为普通属性查询

### 3. Operation (操作类型)
- SELECT (查询)
- INSERT (插入)
- UPDATE (更新)
- DELETE (删除)

### 4. WHERE Condition (条件类型)
- 无条件
- id 等值 (`id = 'value'`)
- id IN (`id IN ['a', 'b']`)
- 其他字段条件

## 组合矩阵

| # | Resource Mode | ID Predicate | Operation | WHERE | 需要测试点 |
|---|---------------|--------------|-----------|-------|-----------|
| 1 | fragment | @id | SELECT | 无 | id 从 subject 提取 |
| 2 | fragment | @id | SELECT | id = | ?subject 比较完整 URI |
| 3 | fragment | @id | SELECT | id IN | ?subject IN (URIs) |
| 4 | fragment | @id | INSERT | - | URI 生成 #id |
| 5 | fragment | @id | UPDATE | id = | 定位到正确 subject |
| 6 | fragment | @id | DELETE | id = | 删除正确 subject |
| 7 | document | @id | SELECT | 无 | id 从文件名提取 |
| 8 | document | @id | SELECT | id = | ?subject 比较完整 URI (.ttl) |
| 9 | document | @id | SELECT | id IN | ?subject IN (URIs) |
| 10 | document | @id | INSERT | - | 创建 id.ttl 文件 |
| 11 | document | @id | UPDATE | id = | 定位到正确文件 |
| 12 | document | @id | DELETE | id = | 删除正确文件 |
| 13 | fragment | custom | SELECT | 无 | ?id 变量查询 |
| 14 | fragment | custom | SELECT | id = | ?id = "value" |
| 15 | fragment | custom | INSERT | - | 写入 predicate triple |
| 16 | fragment | custom | UPDATE | id = | 正常属性更新 |
| 17 | document | custom | SELECT | 无 | ?id 变量查询 |
| 18 | document | custom | SELECT | id = | ?id = "value" |
| 19 | document | custom | INSERT | - | 写入 predicate triple |
| 20 | document | custom | UPDATE | id = | 正常属性更新 |

## 当前测试覆盖状态

待检查...
