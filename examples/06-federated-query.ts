/**
 * 06-federated-query.ts
 *
 * 展示跨 Pod 的联邦查询：
 * 1. 在本地 Pod 中存储朋友列表
 * 2. 用 `client.query` 触发带发现关系的读取
 * 3. 直接使用 FederatedQueryExecutor 做高级控制
 */

import { pod, podTable, string, id, relations, FederatedQueryExecutor } from 'drizzle-solid';
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

  const friends = podTable('friends', {
    id: id(),
    name: string('name').predicate('https://schema.org/name'),
    webId: string('webId').predicate('https://schema.org/identifier'),
  }, {
    base: `${podBase}data/friends.ttl`,
    type: 'https://schema.org/Person',
  });

  const posts = podTable('posts', {
    id: id(),
    title: string('title').predicate('https://schema.org/headline'),
    content: string('content').predicate('https://schema.org/content'),
  }, {
    type: 'https://schema.org/BlogPosting',
    base: '/data/posts/',
  });

  const friendsRelations = relations(friends, ({ many }) => ({
    posts: many(posts.$schema, {
      discover: (friend: any) => friend.webId,
    }),
  }));

  const schema = { friends, posts, friendsRelations };
  const client = pod(session, { schema });
  await client.init(friends);

  console.log('Preparing test data...');

  try {
    await session.fetch(`${podBase}data/friends.ttl`, { method: 'DELETE' });
  } catch {}

  await client.collection(friends).createMany([
    {
      id: 'alice',
      name: 'Alice',
      webId: 'https://alice.solidcommunity.net/profile/card#me',
    },
    {
      id: 'bob',
      name: 'Bob',
      webId: 'https://bob.inrupt.net/profile/card#me',
    },
  ]);

  console.log('Friends inserted.');

  console.log('\n--- Method 1: Using client.query with federated relations ---');

  const friendsList = await client.query.friends.findMany();
  console.log('Friends:', JSON.stringify(friendsList, null, 2));

  const errors = client.getLastFederatedErrors();
  if (errors.length > 0) {
    console.log('Federated errors:', errors);
  }

  console.log('\n--- Method 2: Using FederatedQueryExecutor directly ---');

  const executor = new FederatedQueryExecutor({
    fetch: session.fetch,
    timeout: 10000,
  });

  const result = await executor.execute(
    friendsList.map((friend) => ({ ...friend })),
    {
      type: 'many',
      table: posts.$schema,
      isFederated: true,
      discover: (friend: any) => friend.webId,
      relationName: 'posts',
    },
    {
      parallel: true,
      maxConcurrency: 3,
    },
  );

  console.log('Federated query result:');
  for (const friend of result.data) {
    console.log(`  ${friend.name} (${friend.webId}):`);
    console.log(`    Posts: ${(friend as any).posts?.length || 0}`);
  }

  if (result.errors && result.errors.length > 0) {
    console.log('\nSome queries failed:');
    for (const error of result.errors) {
      console.log(`  [${error.code}] Path: ${error.path.join('.')}`);
      console.log(`    Message: ${error.message}`);
      if (error.url) {
        console.log(`    URL: ${error.url}`);
      }
    }
  }

  console.log('\n--- Method 3: Multiple WebIDs per row ---');

  const groups = podTable('groups', {
    id: id(),
    name: string('name').predicate('https://schema.org/name'),
  }, {
    type: 'https://schema.org/Organization',
    base: '/data/groups/',
  });

  const groupData = [
    {
      id: 'team1',
      name: 'Development Team',
      memberWebIds: [
        'https://alice.solidcommunity.net/profile/card#me',
        'https://bob.inrupt.net/profile/card#me',
      ],
    },
  ];

  const groupResult = await executor.execute(
    groupData,
    {
      type: 'many',
      table: posts.$schema,
      isFederated: true,
      discover: (group: any) => group.memberWebIds,
      relationName: 'memberPosts',
    },
    {
      parallel: true,
      maxConcurrency: 5,
    },
  );

  console.log('Group result:');
  for (const group of groupResult.data) {
    console.log(`  ${group.name}:`);
    console.log(`    Member posts: ${(group as any).memberPosts?.length || 0}`);
  }

  console.log('\nDone!');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { run };
