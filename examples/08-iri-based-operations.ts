/**
 * 08-iri-based-operations.ts
 *
 * 展示 Drizzle Solid 的 IRI 级别操作：
 * 1. db.findByIri() - 通过完整 IRI 查询单个实体
 * 2. db.subscribeByIri() - 订阅单个实体的变更
 * 3. db.updateByIri() - 通过 IRI 更新实体
 * 4. db.deleteByIri() - 通过 IRI 删除实体
 * 
 * 这些 API 适用于：
 * - 查看好友的 Profile（远程 Pod）
 * - 使用引用的远程 Agent
 * - 查看共享的文件
 * - 详情页场景
 * 
 * Schema/Table 分离说明：
 * - 本示例使用 solidSchema + db.createTable 模式
 * - solidSchema 定义纯数据结构（不含 base 和 hooks）
 * - db.createTable 绑定位置和可选的 hooks
 */

import { drizzle, solidSchema, string, datetime, id } from 'drizzle-solid';
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
    tokenType: 'DPoP'
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Login failed');
  }

  return session;
}

function getPodBaseUrl(session: Session): string {
  if (!session.info.webId) throw new Error('No WebID');
  return session.info.webId.split('profile')[0];
}

/**
 * 定义 Schema（纯数据结构，不含 base）
 * 
 * Schema 可以复用于查询任意 Pod 的数据，
 * 通过 db.createTable 或 schema.table() 绑定到具体位置
 */
const profileSchema = solidSchema('profile', {
  id: id(),
  name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  bio: string('bio').predicate('http://schema.org/description'),
}, {
  type: 'http://xmlns.com/foaf/0.1/Person'
});

const agentSchema = solidSchema('agents', {
  id: id(),
  name: string('name').predicate('http://schema.org/name'),
  description: string('description').predicate('http://schema.org/description'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
}, {
  type: 'http://schema.org/SoftwareApplication'
});

async function run(providedSession?: Session) {
  // 1. 认证
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  console.log(`Connected to Pod: ${podBase}`);

  // 2. 创建数据库和表
  const db = drizzle(session);

  // 使用 db.createTable 绑定 schema 到具体位置
  // 如果需要 hooks，可以在这里添加
  const agentTable = db.createTable(agentSchema, {
    base: `${podBase}data/agents.ttl`,
  });

  const profileTable = db.createTable(profileSchema, {
    base: `${podBase}profile/card`,
  });

  await db.init([agentTable]);

  // 3. 创建测试数据
  console.log('\n--- Creating test agent ---');
  const [created] = await db.insert(agentTable).values({
    name: 'Test Agent',
    description: 'An agent for testing IRI operations',
    createdAt: new Date()
  });
  
  const testIri = created['@id'];
  console.log(`Created agent with IRI: ${testIri}`);

  // 4. findByIri - 通过完整 IRI 查询
  console.log('\n--- findByIri Demo ---');
  
  // 查询本地 Pod 的实体
  const agent = await db.findByIri(agentTable, testIri);
  console.log('Found agent:', agent);

  // 业务层不需要区分本地/远程，统一使用 IRI
  // const remoteProfile = await db.findByIri(profileTable, 'https://alice.pod/profile/card#me');

  // 5. subscribeByIri - 订阅单个实体的变更
  console.log('\n--- subscribeByIri Demo ---');
  
  const unsubscribe = await db.subscribeByIri(agentTable, testIri, {
    onUpdate: (data) => {
      console.log('[UPDATE] Agent updated:', data.name);
    },
    onDelete: () => {
      console.log('[DELETE] Agent was deleted');
    },
    onError: (error) => {
      console.error('[ERROR]', error.message);
    }
  });
  console.log('Subscribed to agent changes');

  // 等待订阅建立
  await sleep(1000);

  // 6. updateByIri - 通过 IRI 更新实体
  console.log('\n--- updateByIri Demo ---');
  
  const updated = await db.updateByIri(agentTable, testIri, {
    name: 'Updated Agent Name',
    description: 'Description updated via updateByIri'
  });
  console.log('Updated agent:', updated);

  // 等待通知到达
  await sleep(2000);

  // 7. deleteByIri - 通过 IRI 删除实体
  console.log('\n--- deleteByIri Demo ---');
  
  const deleted = await db.deleteByIri(agentTable, testIri);
  console.log('Delete result:', deleted);

  // 等待通知到达
  await sleep(2000);

  // 8. 清理订阅
  unsubscribe();
  console.log('\nUnsubscribed from agent changes');

  // 9. 验证删除
  const notFound = await db.findByIri(agentTable, testIri);
  console.log('Agent after delete:', notFound); // Should be null

  console.log('\n--- API Comparison ---');
  console.log(`
  | 操作 | 集合/条件 API | 单体 IRI API |
  |------|---------------|--------------|
  | 查询 | find(table, where?) | findByIri(table, iri) |
  | 查询单个 | findFirst(table, where?) | findByIri(table, iri) |
  | 订阅 | subscribe(table, options) | subscribeByIri(table, iri, options) |
  | 更新 | update(table).set(data).where({id}) | updateByIri(table, iri, data) |
  | 删除 | delete(table).where({id}) | deleteByIri(table, iri) |
  `);

  console.log('\nDone!');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 仅在直接运行时执行
if (require.main === module) {
  run().catch(console.error);
}

export { run };
