import { createTestSession, ensureContainer } from '../tests/integration/css/helpers';
import { podTable, string } from '../src/index';
import { drizzle } from '../src/driver';

async function main() {
  const session = await createTestSession();
  const db = drizzle(session);

  const timestamp = Date.now();
  const usersPath = `/drizzle-tests/users-debug-${timestamp}/`;
  const postsPath = `/drizzle-tests/posts-debug-${timestamp}/`;

  const usersTable = podTable('users', {
    id: string('id').primaryKey(),
    name: string('name').notNull()
  }, {
    containerPath: usersPath,
    rdfClass: 'https://schema.org/Person',
    autoRegister: false
  });

  const postsTable = podTable('posts', {
    id: string('id').primaryKey(),
    title: string('title').notNull(),
    authorId: string('authorId').notNull()
  }, {
    containerPath: postsPath,
    rdfClass: 'https://schema.org/CreativeWork',
    autoRegister: false
  });

  const usersContainer = await ensureContainer(session, usersPath);
  const postsContainer = await ensureContainer(session, postsPath);
  const usersResource = `${usersContainer}${usersTable.config.name}.ttl`;
  const postsResource = `${postsContainer}${postsTable.config.name}.ttl`;

  try {
    await db.insert(usersTable).values([
      { id: 'user-1', name: 'Alice Author' },
      { id: 'user-2', name: 'Bob Writer' }
    ]);

    await db.insert(postsTable).values([
      { id: 'post-1', title: 'Solid Intro', authorId: 'user-1' },
      { id: 'post-2', title: 'SPARQL Tricks', authorId: 'user-2' },
      { id: 'post-3', title: 'No Author Yet', authorId: 'user-999' }
    ]);

    const baseRows = await db
      .select({ id: postsTable.id, title: postsTable.title, authorId: postsTable.authorId })
      .from(postsTable)
      ;
    console.log('Base rows', baseRows);

    const leftJoined = await db
      .select({ title: postsTable.title, authorName: usersTable.name })
      .from(postsTable)
      .leftJoin(usersTable, { 'posts.authorId': 'users.id' })
      .orderBy(postsTable.id, 'asc');

    console.log('Left joined rows', leftJoined);
  } finally {
    await session.fetch(postsResource, { method: 'DELETE' }).catch(() => undefined);
    await session.fetch(usersResource, { method: 'DELETE' }).catch(() => undefined);
    await session.fetch(postsContainer, { method: 'DELETE' }).catch(() => undefined);
    await session.fetch(usersContainer, { method: 'DELETE' }).catch(() => undefined);
    await session.logout().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
