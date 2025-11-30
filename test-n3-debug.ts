import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/n3debug-${Date.now()}/`;
  const containerUrl = await ensureContainer(session, containerPath);
  console.log('Container URL:', containerUrl);

  const resourceUrl = `${containerUrl}data.ttl`;

  // First create empty resource
  console.log('\n--- Creating empty resource ---');
  const createRes = await session.fetch(resourceUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: ''
  });
  console.log('Create status:', createRes.status, createRes.statusText);

  // Now try N3 PATCH
  const patch = `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
_:patch a solid:InsertDeletePatch;
  solid:insert {
    <${resourceUrl}#item1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://schema.org/Person> .
    <${resourceUrl}#item1> <https://schema.org/name> "Test User" .
    <${resourceUrl}#item1> <https://schema.org/age> 25 .
  }.`;

  console.log('\n--- Sending N3 PATCH ---');
  console.log('PATCH body:\n', patch);

  const patchRes = await session.fetch(resourceUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/n3' },
    body: patch
  });
  console.log('PATCH status:', patchRes.status, patchRes.statusText);
  const patchBody = await patchRes.text();
  console.log('PATCH response body:', patchBody);

  // Fetch to verify
  console.log('\n--- Fetching resource ---');
  const getRes = await session.fetch(resourceUrl, {
    headers: { 'Accept': 'text/turtle' }
  });
  console.log('GET status:', getRes.status);
  const content = await getRes.text();
  console.log('Content length:', content.length);
  console.log('Content:\n', content);

  // Cleanup
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
