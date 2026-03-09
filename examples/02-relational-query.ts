import { pod, podTable, string, uri } from 'drizzle-solid';
import { relations } from 'drizzle-orm';
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

  const users = podTable('users', {
    id: string('id').primaryKey(),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  }, {
    base: `${podBase}data/users.ttl`,
    type: 'http://xmlns.com/foaf/0.1/Person',
  });

  const posts = podTable('posts', {
    id: string('id').primaryKey(),
    title: string('title').predicate('http://schema.org/headline'),
    authorId: uri('author')
      .predicate('http://schema.org/author')
      .link(users),
  }, {
    base: `${podBase}data/posts.ttl`,
    type: 'http://schema.org/CreativeWork',
  });

  const postsRelations = relations(posts, ({ one }) => ({
    author: one(users, {
      fields: [posts.authorId],
      references: [users.id],
    }),
  }));

  const schema = { users, posts, postsRelations };
  const client = pod(session, { schema });

  console.log('Seeding data...');

  try {
    await session.fetch(`${podBase}data/users.ttl`, { method: 'DELETE' });
    await session.fetch(`${podBase}data/posts.ttl`, { method: 'DELETE' });
  } catch {}

  await client.collection(users).create({ id: 'alice', name: 'Alice' });
  await client.collection(posts).create({ id: 'post-1', title: 'Alice\'s Post', authorId: 'alice' });

  console.log('Executing Relational Query...');

  const results = await client.query.posts.findMany({
    with: {
      author: true,
    },
  });

  console.log('Posts with Authors:', JSON.stringify(results, null, 2));
}

if (require.main === module) {
  run().catch(console.error);
}

export { run };
