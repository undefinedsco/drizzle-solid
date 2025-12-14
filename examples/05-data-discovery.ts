/**
 * 05-data-discovery.ts
 * 
 * 展示数据发现 API 的使用方式
 * 
 * 核心概念：
 * - DataLocation 以 Container 为中心
 * - 一个 Container 可以有多个 Shape（来自不同 app 的注册）
 * - 支持按 appId 或 Shape URL 选择使用哪个 Shape
 */

import { drizzle } from '../src/driver';
import { InteropDiscovery } from '../src/core/discovery';
import type { DataLocation, ShapeInfo } from '../src/core/discovery/types';
import { Session } from '@inrupt/solid-client-authn-node';

// ============================================================
// 示例 1: 基础发现
// ============================================================
export async function basicDiscovery(session: Session) {
  const db = drizzle(session);

  console.log('🔍 Discovering Person data locations...');
  
  // 发现所有 Person 类型的数据位置
  const locations = await db.discover('https://schema.org/Person');

  console.log(`Found ${locations.length} location(s):`);
  for (const loc of locations) {
    console.log(`  📁 Container: ${loc.container}`);
    console.log(`     Source: ${loc.source}`);
    console.log(`     Shapes: ${loc.shapes.length}`);
    
    for (const shape of loc.shapes) {
      console.log(`       - ${shape.url}`);
      console.log(`         registeredBy: ${shape.registeredBy || 'unknown'}`);
    }
  }

  return locations;
}

// ============================================================
// 示例 2: 按应用过滤发现
// ============================================================
export async function discoverByApp(session: Session, appId: string) {
  const db = drizzle(session);

  console.log(`🔍 Discovering data registered by ${appId}...`);
  
  // 方式 1: 使用 discover 的 appId 选项
  const personLocations = await db.discover('https://schema.org/Person', {
    appId: appId
  });

  // 方式 2: 使用 discoverByApp 获取该应用的所有数据
  const allAppData = await db.discoverByApp(appId);

  console.log(`App ${appId} has ${allAppData.length} data registration(s)`);
  
  return { personLocations, allAppData };
}

// ============================================================
// 示例 3: 获取所有注册信息
// ============================================================
export async function listAllRegistrations(session: Session) {
  const db = drizzle(session);

  console.log('📋 Listing all data registrations...');
  
  const registrations = await db.discoverAll();

  for (const reg of registrations) {
    console.log(`\n  📦 ${reg.rdfClass}`);
    console.log(`     Container: ${reg.container}`);
    console.log(`     ShapeTree: ${reg.shapeTree}`);
    console.log(`     Shape: ${reg.shape || 'none'}`);
    console.log(`     Registered by: ${reg.registeredBy || 'unknown'}`);
    console.log(`     Registered at: ${reg.registeredAt?.toISOString() || 'unknown'}`);
  }

  return registrations;
}

// ============================================================
// 示例 4: 从位置创建表 - Shape 选择
// ============================================================
export async function locationToTableWithShapeSelection(
  session: Session,
  location: DataLocation
) {
  const db = drizzle(session);

  console.log(`\n🔧 Converting location to table: ${location.container}`);
  console.log(`   Available shapes: ${location.shapes.length}`);

  // 方式 1: 使用第一个可用的 Shape（默认）
  const table1 = await db.locationToTable(location);
  console.log(`   ✅ Table created with default shape`);

  // 方式 2: 按 appId 选择 Shape
  if (location.shapes.length > 0 && location.shapes[0].registeredBy) {
    const appId = location.shapes[0].registeredBy;
    const table2 = await db.locationToTable(location, { appId });
    console.log(`   ✅ Table created with shape from ${appId}`);
  }

  // 方式 3: 直接传入 ShapeInfo 对象
  const selectedShape = location.shapes.find(s => 
    s.url.includes('community') || s.url.includes('standard')
  );
  if (selectedShape) {
    const table3 = await db.locationToTable(location, { shape: selectedShape });
    console.log(`   ✅ Table created with community shape: ${selectedShape.url}`);
  }

  // 方式 4: 直接传入 Shape URL
  if (location.shapes.length > 0) {
    const table4 = await db.locationToTable(location, { 
      shape: location.shapes[0].url 
    });
    console.log(`   ✅ Table created with shape URL: ${location.shapes[0].url}`);
  }

  return table1;
}

// ============================================================
// 示例 5: 一步发现并转表
// ============================================================
export async function discoverAndCreateTables(session: Session) {
  const db = drizzle(session);

  console.log('\n🚀 Discover and create tables in one step...');

  // 发现所有 Person 表
  const personTables = await db.discoverTablesFor('https://schema.org/Person');

  console.log(`Created ${personTables.length} table(s) for Person type`);

  // 对每个表进行查询
  for (const table of personTables) {
    const data = await db.select().from(table);
    console.log(`  📊 Table ${table.config.name}: ${data.length} row(s)`);
  }

  return personTables;
}

// ============================================================
// 示例 6: 跨 Pod 发现（访问他人分享的数据）
// ============================================================
export async function crossPodDiscovery(
  mySession: Session,
  otherWebId: string
) {
  console.log(`\n🌐 Discovering data shared by ${otherWebId}...`);

  // 创建针对其他用户 Pod 的发现实例
  // 使用我的 session.fetch（带我的认证）和我的 clientId
  const discovery = new InteropDiscovery(
    otherWebId,
    mySession.fetch,
    mySession.info.clientAppId  // 我的应用 ID
  );

  // 发现对方分享给我的 Person 数据
  const locations = await discovery.discover('https://schema.org/Person');

  console.log(`Found ${locations.length} shared location(s)`);
  for (const loc of locations) {
    console.log(`  📁 ${loc.container}`);
    console.log(`     Shapes: ${loc.shapes.map(s => s.url).join(', ')}`);
  }

  return locations;
}

// ============================================================
// 示例 7: 理解多 Shape 场景
// ============================================================
export function explainMultipleShapes() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    多 Shape 场景说明                              ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  场景：同一个数据容器被多个应用注册                                ║
║                                                                   ║
║  Container: https://alice.pod/data/persons/                      ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐ ║
║  │ Acme App 注册:                                               │ ║
║  │   Shape: https://acme.com/shapes/Person.shacl               │ ║
║  │   字段: name, email, acme:department, acme:employeeId       │ ║
║  └─────────────────────────────────────────────────────────────┘ ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────────┐ ║
║  │ Beta App 注册:                                               │ ║
║  │   Shape: https://beta.com/shapes/Person.shacl               │ ║
║  │   字段: name, email, beta:score, beta:level                 │ ║
║  └─────────────────────────────────────────────────────────────┘ ║
║                                                                   ║
║  发现结果 (DataLocation):                                        ║
║  {                                                                ║
║    container: 'https://alice.pod/data/persons/',                 ║
║    shapes: [                                                      ║
║      { url: 'https://acme.com/...', registeredBy: 'acme-app' }, ║
║      { url: 'https://beta.com/...', registeredBy: 'beta-app' }  ║
║    ]                                                              ║
║  }                                                                ║
║                                                                   ║
║  关键点:                                                          ║
║  - 数据存储在同一个位置（Container 唯一）                         ║
║  - 不同 Shape 是对同一数据的不同"视图"                            ║
║  - 选择 Shape 决定了表的字段结构                                  ║
║  - 写入时数据写入同一个 Container                                 ║
║                                                                   ║
╚══════════════════════════════════════════════════════════════════╝
  `);
}

// ============================================================
// 主程序
// ============================================================
export async function run(providedSession?: Session) {
  // 如果没有提供 session，需要认证
  let session: Session;
  if (providedSession) {
    session = providedSession;
  } else {
    // 动态导入避免模块加载问题
    const { getAuthenticatedSession } = await import('./utils/auth');
    session = await getAuthenticatedSession();
  }

  explainMultipleShapes();

  // 1. 基础发现
  const locations = await basicDiscovery(session);

  // 2. 获取所有注册
  await listAllRegistrations(session);

  // 3. 如果有发现结果，演示 Shape 选择
  if (locations.length > 0) {
    await locationToTableWithShapeSelection(session, locations[0]);
  }

  // 4. 一步发现并转表
  await discoverAndCreateTables(session);

  console.log('\n✅ Data discovery examples completed!');
}

// 仅在直接运行时执行
if (require.main === module) {
  run().catch(console.error);
}

export { run as main };
