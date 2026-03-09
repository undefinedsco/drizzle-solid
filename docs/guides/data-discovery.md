# 数据发现

数据发现让应用不必硬编码 Pod 中的实际数据 URL。

主线入口：

- `client.discovery.discover(...)`
- `client.locationToTable(location, options?)`
- `client.discoverTablesFor(...)`

## 基础发现

```ts
import { pod } from '@undefineds.co/drizzle-solid';

const client = pod(session);
const locations = await client.discovery.discover('https://schema.org/Person');
```

每个 `DataLocation` 以 container 为中心，包含：

- `container`
- `source`
- `shapes`

## 从发现结果生成表

```ts
const table = await client.locationToTable(location);
const rows = await client.collection(table).list();
```

如果同一个 container 有多个 shape，可以指定：

```ts
await client.locationToTable(location, { appId: 'https://acme.example/app#id' });
await client.locationToTable(location, { shape: location.shapes[0] });
await client.locationToTable(location, { shape: location.shapes[0].url });
```

## 一步发现并转表

```ts
const tables = await client.discoverTablesFor('https://schema.org/Person');
for (const table of tables) {
  console.log(await client.collection(table).list());
}
```

## 跨 Pod 发现

如果你需要用“我的认证 fetch”去发现别人的共享数据：

```ts
import { pod, solid } from '@undefineds.co/drizzle-solid';

const discoveryClient = pod(solid({
  webId: 'https://alice.example/profile/card#me',
  fetch: mySession.fetch,
}));

const sharedLocations = await discoveryClient.discovery.discover('https://schema.org/Person');
```

## 设计重点

- **container 是持久化位置主键**
- **shape 是同一份数据的不同结构视图**
- **发现与建模是两步**：先找到位置，再决定如何 materialize 成表

相关 example：`examples/05-data-discovery.ts`
