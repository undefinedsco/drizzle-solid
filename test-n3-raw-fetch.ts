import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/n3raw-${Date.now()}/`;
  const containerUrl = await ensureContainer(session, containerPath);
  console.log('Container URL:', containerUrl);

  const resourceUrl = `${containerUrl}data.ttl`;
  const subject = `${resourceUrl}#item1`;

  // Step 1: Create empty resource
  console.log('\n--- Step 1: Create empty resource with PUT ---');
  const createRes = await session.fetch(resourceUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: ''
  });
  console.log('PUT status:', createRes.status, createRes.statusText);

  // Step 2: Check the EXACT N3 body we're sending
  const n3Body = `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
_:patch a solid:InsertDeletePatch;
  solid:inserts {
    <${subject}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://schema.org/Person> .
    <${subject}> <https://schema.org/name> "Alice Example" .
  }.`;

  console.log('\n--- Step 2: N3 PATCH body (string length:', n3Body.length, ') ---');
  console.log('Body:\n', n3Body);
  console.log('\n--- Hex dump of body: ---');
  const bytes = Buffer.from(n3Body, 'utf-8');
  console.log('Bytes:', bytes.length);

  // Step 3: Send PATCH
  console.log('\n--- Step 3: Sending N3 PATCH ---');
  const patchRes = await session.fetch(resourceUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'text/n3',
      'Content-Length': String(bytes.length)
    },
    body: n3Body
  });
  console.log('PATCH status:', patchRes.status, patchRes.statusText);
  const patchRespBody = await patchRes.text();
  if (patchRespBody) console.log('PATCH response:', patchRespBody.substring(0, 200));

  // Step 4: Verify content
  console.log('\n--- Step 4: Verify content ---');
  const getRes = await session.fetch(resourceUrl, {
    headers: { Accept: 'text/turtle' }
  });
  console.log('GET status:', getRes.status);
  const content = await getRes.text();
  console.log('Content:\n', content);

  // Cleanup
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
