/**
 * 08-iri-based-operations.ts
 *
 * 展示 drizzle-solid 的 entity / IRI API：
 * 1. client.bind() - 将 schema 绑定到具体 Pod 布局
 * 2. client.entity(table, iri) - 通过完整 IRI 打开单个实体
 * 3. entity.get()/update()/delete()/subscribe()
 */

import { pod, solidSchema, string, datetime, id } from 'drizzle-solid';
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

const profileSchema = solidSchema({
  id: id(),
  name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  bio: string('bio').predicate('http://schema.org/description'),
}, {
  type: 'http://xmlns.com/foaf/0.1/Person'
});

const agentSchema = solidSchema({
  id: id(),
  name: string('name').predicate('http://schema.org/name'),
  description: string('description').predicate('http://schema.org/description'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
}, {
  type: 'http://schema.org/SoftwareApplication'
});

async function run(providedSession?: Session) {
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  console.log(`Connected to Pod: ${podBase}`);

  const client = pod(session);

  const agentTable = client.bind(agentSchema, {
    base: `${podBase}data/agents.ttl`,
  });

  const profileTable = client.bind(profileSchema, {
    base: `${podBase}profile/card`,
  });

  await client.init(agentTable);

  console.log('\n--- Creating test agent ---');
  const agents = client.collection(agentTable);
  const created = await agents.create({
    name: 'Test Agent',
    description: 'An agent for testing IRI operations',
    createdAt: new Date()
  });

  const testIri = created?.['@id'];
  if (!testIri) {
    throw new Error('Failed to create agent IRI');
  }
  console.log(`Created agent with IRI: ${testIri}`);

  console.log('\n--- entity.get() Demo ---');
  const agent = client.entity(agentTable, testIri);
  console.log('Found agent:', await agent.get());

  console.log('\n--- Remote IRI shape binding Demo ---');
  if (session.info.webId) {
    const profile = client.entity(profileTable, session.info.webId);
    console.log('Local profile via entity API:', await profile.get());
  }

  console.log('\n--- entity.subscribe() Demo ---');
  const unsubscribe = await agent.subscribe({
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

  await sleep(1000);

  console.log('\n--- entity.update() Demo ---');
  const updated = await agent.update({
    name: 'Updated Agent Name',
    description: 'Description updated via entity.update()'
  });
  console.log('Updated agent:', updated);

  await sleep(2000);

  console.log('\n--- entity.delete() Demo ---');
  const deleted = await agent.delete();
  console.log('Delete result:', deleted);

  await sleep(2000);

  unsubscribe();
  console.log('\nUnsubscribed from agent changes');
  console.log('Agent after delete:', await agent.get());

  console.log('\n--- API Comparison ---');
  console.log(`
  | 推荐心智 | API |
  |----------|-----|
  | 集合读取 | client.collection(table).list()/first() |
  | 精确实体 | client.entity(table, iri).get()/update()/delete()/subscribe() |
  | 位置绑定 | client.bind(schema, { base }) |
  | 兼容 builder | client.asDrizzle() |
  `);

  console.log('\nDone!');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
  run().catch(console.error);
}

export { run };
