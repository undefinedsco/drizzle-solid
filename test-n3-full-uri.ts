import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/n3full-${Date.now()}/`;
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

  // Try different N3 PATCH variants

  // Variant 1: Using solid:inserts instead of solid:insert (as per Solid spec)
  const patch1 = `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
_:patch a solid:InsertDeletePatch;
  solid:inserts {
    <${resourceUrl}#item1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://schema.org/Person> .
    <${resourceUrl}#item1> <https://schema.org/name> "Test User" .
  }.`;

  console.log('\n--- Try 1: solid:inserts ---');
  console.log('PATCH body:\n', patch1);

  const patchRes1 = await session.fetch(resourceUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/n3' },
    body: patch1
  });
  console.log('PATCH status:', patchRes1.status, patchRes1.statusText);
  const patchBody1 = await patchRes1.text();
  if (patchBody1) console.log('PATCH response:', patchBody1.substring(0, 200));

  // Check content
  let getRes = await session.fetch(resourceUrl, { headers: { 'Accept': 'text/turtle' } });
  let content = await getRes.text();
  console.log('Content after try 1:', content.length > 0 ? content : '(empty)');

  // Variant 2: Try without solid:InsertDeletePatch type
  const patch2 = `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
[] solid:inserts {
    <${resourceUrl}#item2> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://schema.org/Person> .
    <${resourceUrl}#item2> <https://schema.org/name> "Test User 2" .
  }.`;

  console.log('\n--- Try 2: blank node without explicit type ---');
  const patchRes2 = await session.fetch(resourceUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'text/n3' },
    body: patch2
  });
  console.log('PATCH status:', patchRes2.status);

  getRes = await session.fetch(resourceUrl, { headers: { 'Accept': 'text/turtle' } });
  content = await getRes.text();
  console.log('Content after try 2:', content.length > 0 ? content : '(empty)');

  // Cleanup
  await session.fetch(resourceUrl, { method: 'DELETE' });
  await session.fetch(containerUrl, { method: 'DELETE' });
}

main().catch(console.error);
