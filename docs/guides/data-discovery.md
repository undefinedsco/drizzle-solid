# 数据发现与 SAI 互操作

Drizzle Solid 支持 Solid 生态中的两种数据发现机制：**TypeIndex** 和 **SAI (Solid Application Interoperability)**。这使得应用可以发现用户 Pod 中特定类型的数据位置，而无需硬编码路径。

## 核心概念

### 数据发现的意义

在传统数据库中，表的位置是固定的。但在 Solid 生态中：
- 每个用户的 Pod 结构可能不同
- 同一类型的数据可能被多个应用注册在不同位置
- 应用需要动态发现数据存储位置

### TypeIndex vs SAI

| 特性 | TypeIndex | SAI (Interop) |
|------|-----------|---------------|
| 复杂度 | 简单 | 较复杂 |
| 功能 | 类型到位置的映射 | 完整的应用间互操作 |
| Shape 支持 | 无 | 支持 ShapeTree 和 SHACL Shape |
| 权限管理 | 基础 | 细粒度的 AccessGrant |
| 应用隔离 | 无 | 按应用 ID 区分 |

## DataLocation 结构

发现结果以 `DataLocation` 形式返回，**以 Container 为中心**：

```typescript
interface DataLocation {
  /** 数据容器 URL - 唯一标识数据位置 */
  container: string;
  
  /** 可用的 Shape 列表（来自不同 app 的注册） */
  shapes: ShapeInfo[];
  
  /** 发现来源 */
  source: 'typeindex' | 'interop' | 'config';
}

interface ShapeInfo {
  /** Shape URL (SHACL Shape 定义) */
  url: string;
  
  /** ShapeTree URL */
  shapeTree?: string;
  
  /** 注册此 Shape 的应用 ID */
  registeredBy?: string;
  
  /** 发现来源 */
  source: 'typeindex' | 'interop' | 'config';
}
```

**设计原则**：一个 Container 可能有多个 Shape 描述（来自不同应用的注册），但数据是统一存储在同一个位置的。

## 使用方式

### 1. 基本发现

```typescript
import { drizzle } from 'drizzle-solid';

const db = drizzle(session);

// 发现某类型的所有数据位置
const locations = await db.discovery.discover('https://schema.org/Person');

console.log(locations);
// [
//   {
//     container: 'https://alice.pod/data/persons/',
//     shapes: [
//       { url: 'https://acme.com/PersonShape.shacl', registeredBy: 'https://acme.com/app#id', ... },
//       { url: 'https://beta.com/PersonShape.shacl', registeredBy: 'https://beta.com/app#id', ... }
//     ],
//     source: 'interop'
//   }
// ]
```

### 2. 按应用过滤

```typescript
// 只发现某个应用注册的数据
const acmeLocations = await db.discovery.discover('https://schema.org/Person', {
  appId: 'https://acme.com/app#id'
});
```

### 3. 获取所有注册信息

```typescript
// 获取所有数据注册的详细信息
const allRegistrations = await db.discovery.discoverAll();

for (const reg of allRegistrations) {
  console.log(`${reg.rdfClass} at ${reg.container}`);
  console.log(`  Shape: ${reg.shape}`);
  console.log(`  Registered by: ${reg.registeredBy}`);
  console.log(`  Registered at: ${reg.registeredAt}`);
}
```

### 4. 按应用发现所有数据

```typescript
// 发现某个应用注册的所有数据类型
const acmeData = await db.discovery.discoverByApp('https://acme.com/app#id');
```

## 从位置到表

发现数据位置后，可以转换为 `PodTable` 进行查询：

### 基本转换

```typescript
const locations = await db.discovery.discover('https://schema.org/Person');
const table = await db.locationToTable(locations[0]);

// 现在可以查询
const persons = await db.select().from(table);
```

### 选择特定的 Shape

当一个 Container 有多个 Shape 时，需要选择使用哪个：

```typescript
// 方式 1: 按 appId 选择
const table = await db.locationToTable(location, {
  appId: 'https://acme.com/app#id'
});

// 方式 2: 直接传入 ShapeInfo 对象
const acmeShape = location.shapes.find(s => 
  s.registeredBy === 'https://acme.com/app#id'
);
const table = await db.locationToTable(location, {
  shape: acmeShape
});

// 方式 3: 传入 Shape URL
const table = await db.locationToTable(location, {
  shape: 'https://shapes.example/Person.shacl'
});

// 方式 4: 不传参数，使用第一个可用的 Shape
const table = await db.locationToTable(location);
```

### 一步发现并转表

```typescript
// 发现并转换为表（简化 API）
const tables = await db.discoverTablesFor('https://schema.org/Person');

// 带过滤的发现
const acmeTables = await db.discoverTablesFor(
  'https://schema.org/Person',
  { appId: 'https://acme.com/app#id' },  // 发现选项
  { appId: 'https://acme.com/app#id' }   // Shape 选择选项
);
```

## 数据注册

### 使用 TypeIndex 注册

在表定义中启用 TypeIndex：

```typescript
const persons = podTable('persons', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: '/data/persons/',
  type: 'https://schema.org/Person',
  typeIndex: 'private'  // 或 'public'
});

// 初始化时自动注册到 TypeIndex
await db.init(persons);
```

### 使用 SAI 注册

SAI 注册使用同一套 `db.discovery` 接口，并且必须显式提供 `registryPath`：

```typescript
// 注册表（缺少 RegistrySet 时会自动创建，需要提供 registryPath）
await db.discovery.register(table, {
  registryPath: 'https://alice.pod/registries/your-app/',
  shapeUrl: 'https://shapes.example/Person.shacl',  // 可选
  containerSlug: 'persons',  // 自定义容器名
  force: false  // 是否强制重新注册
});

### 同时注册 TypeIndex + SAI（推荐）

在表配置中声明 TypeIndex 和 SAI RegistrySet 路径，`db.init()` 会自动注册两者：

```typescript
const persons = podTable('persons', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: '/data/persons/',
  type: 'https://schema.org/Person',
  typeIndex: 'private',
  saiRegistryPath: 'https://alice.pod/registries/your-app/',
});

await db.init(persons);
```
```

## 场景示例

### 场景 1: 社区 Shape vs 应用私有 Shape

```
社区定义了通用的 Person Shape:
  https://solidproject.org/shapes/Person.shacl
  - 包含: name, email, birthDate

Acme App 扩展了 Person Shape:
  https://acme.com/shapes/Person.shacl  
  - 包含: name, email, birthDate, acme:department, acme:employeeId

Beta App 也扩展了 Person Shape:
  https://beta.com/shapes/Person.shacl
  - 包含: name, email, birthDate, beta:score, beta:level
```

当发现数据时：

```typescript
const locations = await db.discovery.discover('https://schema.org/Person');
// locations[0].shapes 包含三个 Shape

// 使用社区 Shape（只有基本字段）
const communityTable = await db.locationToTable(locations[0], {
  shape: 'https://solidproject.org/shapes/Person.shacl'
});

// 使用 Acme 的 Shape（包含 department, employeeId）
const acmeTable = await db.locationToTable(locations[0], {
  appId: 'https://acme.com/app#id'
});
```

### 场景 2: 跨 Pod 数据访问

```typescript
// Alice 授权了 Bob 访问她的联系人数据
const bobDb = drizzle(bobSession);

// 发现 Alice Pod 中 Bob 有权访问的数据
import { solid } from 'drizzle-solid';

const discoveryDb = drizzle(
  solid({
    webId: 'https://alice.pod/profile/card#me',
    fetch: bobSession.fetch
  })
);

const locations = await discoveryDb.discovery.discover('https://schema.org/Person');
// 返回 Alice 授权给 Bob 的数据位置
```

## 架构说明

### 发现策略

Drizzle Solid 使用 `CompositeDiscovery` 聚合多种发现策略：

```
CompositeDiscovery
├── TypeIndexDiscovery   (从 TypeIndex 发现)
└── InteropDiscovery     (从 SAI Registry 发现)
```

结果会按 Container 合并，同一个 Container 的多个 Shape 会合并到 `shapes` 数组中。

`db.discovery` 返回 DataDiscovery 接口；`PodDatabase` 还提供了 `discover()`/`discoverAll()` 等便捷封装。

### 为什么以 Container 为中心？

之前的设计以 Shape 为中心，导致问题：
- 同一个 Container 被多个 app 注册时，会返回多条记录
- 写入时不知道该写到哪个位置

以 Container 为中心的设计：
- 一个 Container = 一条记录
- 多个 Shape 只是对同一数据的不同描述
- 写入目标明确

## API 参考

### PodDatabase 方法

| 方法 | 说明 |
|------|------|
| `discover(rdfClass, options?)` | 发现某类型的数据位置 |
| `discoverAll()` | 获取所有数据注册信息 |
| `discoverByApp(appId)` | 按应用 ID 发现数据 |
| `locationToTable(location, options?)` | 将位置转换为 PodTable |
| `discoverTablesFor(rdfClass, discoverOpts?, tableOpts?)` | 发现并转换为表 |

### DataDiscovery 接口（`db.discovery`）

| 方法 | 说明 |
|------|------|
| `register(table, options?)` | 注册数据类型（TypeIndex + SAI；SAI 需提供 `registryPath`） |
| `discover(rdfClass, options?)` | 发现某类型的数据位置 |
| `discoverAll()` | 获取所有数据注册信息 |
| `discoverByApp(appId)` | 按应用 ID 发现数据 |
| `isRegistered(rdfClass)` | 检查类型是否已注册 |

### DiscoverOptions

```typescript
interface DiscoverOptions {
  selfOnly?: boolean;   // 只查找自己注册的
  origin?: string;      // 按应用 origin 过滤
  appId?: string;       // 按应用 ID 过滤
}
```

### LocationToTableOptions

```typescript
interface LocationToTableOptions {
  shape?: ShapeInfo | string;  // 指定 Shape
  appId?: string;              // 按 appId 选择 Shape
}
```

## 相关资源

- [示例代码: 05-data-discovery.ts](../../examples/05-data-discovery.ts) - 完整的数据发现示例
- [示例代码: 03-zero-config-discovery.ts](../../examples/03-zero-config-discovery.ts) - 零配置访问示例
- [Solid Application Interoperability Spec](https://solid.github.io/data-interoperability-panel/specification/)
- [TypeIndex Spec](https://solid.github.io/type-indexes/)
- [ShapeTree Spec](https://shapetrees.org/TR/specification/)
- [SHACL](https://www.w3.org/TR/shacl/)
