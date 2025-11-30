import { createTestSession, ensureContainer } from './tests/integration/css/helpers';

async function main() {
  const session = await createTestSession();
  console.log('Session WebID:', session.info.webId);

  const containerPath = `/test/putdebug-${Date.now()}/`;
  const containerUrl = await ensureContainer(session, containerPath);
  console.log('Container URL:', containerUrl);

  const resourceUrl = `${containerUrl}data.ttl`;

  // PUT with actual content
  const turtleContent = `@prefix schema: <https://schema.org/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

<#item1> rdf:type schema:Person ;
    schema:name "Test User" ;
    schema:age 25 .
`;

  console.log('\n--- PUT with Turtle content ---');
  console.log('Content:\n', turtleContent);

  const putRes = await session.fetch(resourceUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body: turtleContent
  });
  console.log('PUT status:', putRes.status, putRes.statusText);
  const putBody = await putRes.text();
  if (putBody) console.log('PUT response body:', putBody);

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
