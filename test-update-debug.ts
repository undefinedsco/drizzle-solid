import { createTestSession, ensureContainer } from './tests/integration/css/helpers';
import { drizzle } from './src/driver';
import { podTable, string, int, date } from './src/index';
import { SCHEMA_INRUPT as SCHEMA } from '@inrupt/vocab-common-rdf';

async function main() {
  // Enable DEBUG_INLINE_PATCH to see the PATCH body
  process.env.DEBUG_INLINE_PATCH = 'true';

  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/update-debug-${Date.now()}/`;
  const containerUrl = await ensureContainer(session, containerPath);
  console.log('Container URL:', containerUrl);

  const resourceUrl = `${containerUrl}profiles.ttl`;
  const schemaNamespace = { prefix: SCHEMA.PREFIX, uri: SCHEMA.NAMESPACE };

  const profileTable = podTable('profiles', {
    id: string('id').primaryKey().predicate('https://schema.org/identifier'),
    name: string('name').notNull().predicate('https://schema.org/name'),
    age: int('age').predicate('https://schema.org/age'),
    createdAt: date('createdAt').notNull().predicate('https://schema.org/dateCreated')
  }, {
    base: resourceUrl,
    type: 'https://schema.org/Person',
    namespace: schemaNamespace,
    typeIndex: undefined
  });

  const db = drizzle(session);

  // Manual resource creation instead of db.init
  console.log('\n--- Creating resource manually ---');
  const createRes = await session.fetch(resourceUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: ''
  });
  console.log('PUT status:', createRes.status);

  const recordId = `profile-${Date.now()}`;

  // Insert a record (without db.init)
  console.log('\n--- INSERT ---');
  await db.insert(profileTable).values({
    id: recordId,
    name: 'Alice Example',
    age: 30,
    createdAt: new Date()
  });

  // Check content after insert
  console.log('\n--- Fetch after INSERT ---');
  let res = await session.fetch(resourceUrl, { headers: { Accept: 'text/turtle' } });
  let content = await res.text();
  console.log('Content:\n', content);

  // Clean up
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
