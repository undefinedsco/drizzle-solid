/**
 * 01-quick-start.ts
 *
 * 展示 drizzle-solid 的 Solid-first 主线 API：
 * 1. 连接 Solid Pod
 * 2. 定义资源模型
 * 3. 通过 collection API 创建和查询实体
 * 4. 通过 entity API 做精确更新/删除
 */

import { pod, podTable, string, datetime } from 'drizzle-solid';
import { v4 as uuid } from 'uuid';

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

async function run(providedSession?: Session) {
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  console.log(`Connected to Pod: ${podBase}`);

  const posts = podTable('posts', {
    id: string('id').primaryKey(),
    title: string('title').predicate('http://schema.org/headline'),
    content: string('content').predicate('http://schema.org/text'),
    createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
  }, {
    base: `${podBase}data/posts/`,
    subjectTemplate: '{id}.ttl',
    type: 'http://schema.org/CreativeWork'
  });

  const client = pod(session);
  await client.init(posts);

  const postsCollection = client.collection(posts);

  const newId = uuid();
  console.log(`Creating post... ${newId}`);

  const draft = {
    id: newId,
    title: 'Hello Drizzle Solid',
    content: 'This is my first post using a Solid-first API on top of Drizzle Solid.',
    createdAt: new Date()
  };

  const created = await postsCollection.create(draft);

  console.log('Created post:', created);

  console.log('Reading posts...');
  const result = await postsCollection.list();
  console.log('Found posts:', result);

  const createdIri = created?.['@id'] ?? postsCollection.iriFor(draft);

  const postRef = postsCollection.byIri(createdIri);
  await postRef.update({ title: 'Hello Pod API' });
  console.log('Updated post via entity API:', await postRef.get());

  await postRef.delete();
  console.log('Deleted post via entity API');
}

if (require.main === module) {
  run().catch(console.error);
}

export { run };
