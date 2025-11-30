import { createTestSession, ensureContainer } from './tests/integration/css/helpers';
import { drizzle } from './src/driver';
import { podTable, string, int, datetime } from './src/core/pod-table';

// Enable debug logging
process.env.DEBUG_INLINE_PATCH = 'true';

const schemaNamespace = { prefix: 'schema', uri: 'https://schema.org/' };

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/debug-${Date.now()}/`;
  const containerUrl = await ensureContainer(session, containerPath);
  console.log('Container URL:', containerUrl);

  const profileTable = podTable('profiles', {
    id: string('id').primaryKey().predicate('https://schema.org/identifier'),
    name: string('name').notNull().predicate('https://schema.org/name'),
    age: int('age').predicate('https://schema.org/age'),
    createdAt: datetime('createdAt').predicate('https://schema.org/dateCreated')
  }, {
    base: containerPath + 'profiles.ttl',
    type: 'https://schema.org/Person',
    namespace: schemaNamespace,
    typeIndex: undefined
  });

  const db = drizzle(session);
  await db.init(profileTable);

  // Insert
  const recordId = `profile-${Date.now()}`;
  console.log('Inserting record:', recordId);

  try {
    const insertResult = await db.insert(profileTable).values({
      id: recordId,
      name: 'Test User',
      age: 25,
      createdAt: new Date()
    });
    console.log('Insert result:', JSON.stringify(insertResult, null, 2));
  } catch (err) {
    console.error('Insert error:', err);
  }

  // Direct fetch to check data
  const resourceUrl = containerUrl + 'profiles.ttl';
  console.log('Fetching resource:', resourceUrl);
  const response = await session.fetch(resourceUrl);
  console.log('Response status:', response.status, response.statusText);
  const content = await response.text();
  console.log('Resource content length:', content.length);
  console.log('Resource content:\n', content);

  // Select
  console.log('Selecting...');
  const results = await db.select().from(profileTable).where({ id: recordId });
  console.log('Select results:', results);

  // Cleanup
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
