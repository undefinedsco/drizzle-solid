/**
 * 05-data-discovery.ts
 *
 * 展示数据发现 API 的使用方式。
 *
 * 核心概念：
 * - DataLocation 以 Container 为中心
 * - 一个 Container 可以有多个 Shape（来自不同 app 的注册）
 * - 支持按 appId 或 Shape URL 选择使用哪个 Shape
 */

import { pod, solid, podTable, id, string, type DataLocation } from 'drizzle-solid';
import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

async function getAuthenticatedSession(): Promise<Session> {
  const session = new Session();
  const clientId = process.env.SOLID_CLIENT_ID;
  const clientSecret = process.env.SOLID_CLIENT_SECRET;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER || 'http://localhost:3000/';

  if (!clientId || !clientSecret) {
    throw new Error('Missing SOLID_CLIENT_ID or SOLID_CLIENT_SECRET');
  }

  await session.login({
    clientId,
    clientSecret,
    oidcIssuer,
    tokenType: 'DPoP',
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Login failed');
  }

  return session;
}

function getPodBaseUrl(session: Session): string {
  if (!session.info.webId) {
    throw new Error('No WebID');
  }
  return session.info.webId.split('profile')[0];
}

export async function basicDiscovery(session: Session) {
  const client = pod(session);

  console.log('🔍 Discovering Person data locations...');
  const locations = await client.discovery.discover('https://schema.org/Person');

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

async function initDiscovery(session: Session) {
  const podBase = getPodBaseUrl(session);
  const registryPath = `${podBase}registries/drizzle-solid/`;
  const personContainer = `${podBase}data/persons-discovery/`;

  const personTable = podTable('person-discovery', {
    id: id(),
    name: string('name').predicate('http://schema.org/name'),
  }, {
    type: 'https://schema.org/Person',
    base: personContainer,
    containerPath: personContainer,
    saiRegistryPath: registryPath,
  });

  const client = pod(session);
  await client.init(personTable);

  return { client, personTable, personContainer, registryPath };
}

export async function discoverByApp(session: Session, appId: string) {
  const client = pod(session);

  console.log(`🔍 Discovering data registered by ${appId}...`);

  const personLocations = await client.discovery.discover('https://schema.org/Person', {
    appId,
  });
  const allAppData = await client.discovery.discoverByApp?.(appId) ?? [];

  console.log(`App ${appId} has ${allAppData.length} data registration(s)`);

  return { personLocations, allAppData };
}

export async function listAllRegistrations(session: Session) {
  const client = pod(session);

  console.log('📋 Listing all data registrations...');
  const registrations = await client.discovery.discoverAll?.() ?? [];

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

export async function locationToTableWithShapeSelection(
  session: Session,
  location: DataLocation,
) {
  const client = pod(session);

  console.log(`\n🔧 Converting location to table: ${location.container}`);
  console.log(`   Available shapes: ${location.shapes.length}`);

  const table1 = await client.locationToTable(location);
  console.log('   ✅ Table created with default shape');

  if (location.shapes.length > 0 && location.shapes[0].registeredBy) {
    const appId = location.shapes[0].registeredBy;
    await client.locationToTable(location, { appId });
    console.log(`   ✅ Table created with shape from ${appId}`);
  }

  const selectedShape = location.shapes.find((shape) => (
    shape.url.includes('community') || shape.url.includes('standard')
  ));
  if (selectedShape) {
    await client.locationToTable(location, { shape: selectedShape });
    console.log(`   ✅ Table created with community shape: ${selectedShape.url}`);
  }

  if (location.shapes.length > 0) {
    await client.locationToTable(location, {
      shape: location.shapes[0].url,
    });
    console.log(`   ✅ Table created with shape URL: ${location.shapes[0].url}`);
  }

  return table1;
}

export async function discoverAndCreateTables(session: Session) {
  const client = pod(session);

  console.log('\n🚀 Discover and create tables in one step...');

  const personTables = await client.discoverTablesFor('https://schema.org/Person');

  console.log(`Created ${personTables.length} table(s) for Person type`);

  for (const table of personTables) {
    const data = await client.collection(table).list();
    console.log(`  📊 Table ${table.config.name}: ${data.length} row(s)`);
  }

  return personTables;
}

export async function crossPodDiscovery(
  mySession: Session,
  otherWebId: string,
) {
  console.log(`\n🌐 Discovering data shared by ${otherWebId}...`);

  const discoveryClient = pod(
    solid({
      webId: otherWebId,
      fetch: mySession.fetch,
      sessionId: mySession.info.sessionId ?? 'cross-pod-discovery',
    }),
  );

  const locations = await discoveryClient.discovery.discover('https://schema.org/Person');

  console.log(`Found ${locations.length} shared location(s)`);
  for (const loc of locations) {
    console.log(`  📁 ${loc.container}`);
    console.log(`     Shapes: ${loc.shapes.map((shape) => shape.url).join(', ')}`);
  }

  return locations;
}

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

export async function run(providedSession?: Session) {
  const session = providedSession ?? await getAuthenticatedSession();

  explainMultipleShapes();
  await initDiscovery(session);

  const locations = await basicDiscovery(session);
  await listAllRegistrations(session);

  if (locations.length > 0) {
    await locationToTableWithShapeSelection(session, locations[0]);
  }

  await discoverAndCreateTables(session);

  console.log('\n✅ Data discovery examples completed!');
}

if (require.main === module) {
  run().catch(console.error);
}

export { run as main };
