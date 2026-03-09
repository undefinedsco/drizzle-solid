/**
 * 04-notifications.ts
 *
 * 展示 drizzle-solid 的 Solid-first 实时通知 API：
 * 1. 使用 collection.subscribe() 订阅集合变化
 * 2. 按类型接收通知 (onCreate/onUpdate/onDelete)
 * 3. 在回调中继续使用 collection/entity API 查询最新数据
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

async function run(providedSession?: Session) {
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  console.log(`Connected to Pod: ${podBase}`);

  const posts = podTable('posts', {
    id: string('id').primaryKey(),
    title: string('title').predicate('http://schema.org/headline'),
    content: string('content').predicate('http://schema.org/text'),
    createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated'),
  }, {
    base: `${podBase}data/posts.ttl`,
    type: 'http://schema.org/CreativeWork',
  });

  const client = pod(session);
  await client.init(posts);

  const postsCollection = client.collection(posts);

  console.log('\nSubscribing to posts collection...');

  const subscription = await postsCollection.subscribe({
    onCreate: async (activity) => {
      console.log(`\n[CREATE] ${activity.object}`);
      console.log(`  Published: ${activity.published}`);
      const latest = await postsCollection.list();
      console.log(`  Current posts count: ${latest.length}`);
    },
    onUpdate: async (activity) => {
      console.log(`\n[UPDATE] ${activity.object}`);
      console.log(`  Published: ${activity.published}`);
      const latest = await postsCollection.list();
      console.log(`  Current posts count: ${latest.length}`);
    },
    onDelete: async (activity) => {
      console.log(`\n[DELETE] ${activity.object}`);
      console.log(`  Published: ${activity.published}`);
      const latest = await postsCollection.list();
      console.log(`  Current posts count: ${latest.length}`);
    },
    onAdd: (activity) => {
      console.log(`\n[ADD] ${activity.object} -> ${activity.target}`);
    },
    onRemove: (activity) => {
      console.log(`\n[REMOVE] ${activity.object} <- ${activity.target}`);
    },
    onError: (error) => {
      console.error('[ERROR]', error.message);
    },
    onClose: () => {
      console.log('[CLOSE] Subscription closed');
    },
  });

  console.log(`Subscribed via ${subscription.channel} channel`);
  console.log('Waiting for notifications...\n');

  const testId = uuid();

  console.log('Creating a new post...');
  const created = await postsCollection.create({
    id: testId,
    title: 'Notification Test',
    content: 'This post was created to test notifications.',
    createdAt: new Date(),
  });

  if (!created?.['@id']) {
    throw new Error('Expected create() to return an entity with @id');
  }

  await sleep(2000);

  console.log('Updating the post by exact IRI...');
  const post = postsCollection.byIri(created['@id']);
  await post.update({ title: 'Updated Title' });

  await sleep(2000);

  console.log('Deleting the post by exact IRI...');
  await post.delete();

  await sleep(2000);

  console.log('\nUnsubscribing...');
  subscription.unsubscribe();

  console.log('Done!');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  run().catch(console.error);
}

export { run };
