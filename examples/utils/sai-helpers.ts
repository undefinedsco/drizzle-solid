import { podTable, id, uri, INTEROP } from 'drizzle-solid';
import { Session } from '@inrupt/solid-client-authn-node';
import { getSolidDataset, getThing, setUrl, setThing, saveSolidDatasetAt } from '@inrupt/solid-client';
import { drizzle } from 'drizzle-solid';

// SAI Table Definitions (Internal Helper)
export const getSaiTables = (podBase: string) => {
  const registriesPath = `${podBase}registries/chat-example/`;
  const agentRegistryPath = `${registriesPath}agents/`;
  const appRegResource = `${agentRegistryPath}chat-app.ttl`;

  const registrySet = podTable('set', {
    id: id(),
    hasAgentRegistry: uri('hasAgentRegistry').array().predicate('http://www.w3.org/ns/solid/interop#hasAgentRegistry'),
  }, { type: INTEROP.RegistrySet, containerPath: registriesPath });

  const dataGrant = podTable('data-grant', {
    id: id(),
    registeredShapeTree: uri('registeredShapeTree').predicate(INTEROP.registeredShapeTree),
    hasDataRegistration: uri('hasDataRegistration').predicate(INTEROP.hasDataRegistration),
    scopeOfGrant: uri('scopeOfGrant').predicate(INTEROP.scopeOfGrant),
  }, { type: INTEROP.DataGrant, base: appRegResource });

  const accessGrant = podTable('grant', {
    id: id(),
    hasDataGrant: uri('hasDataGrant').array().predicate(INTEROP.hasDataGrant),
  }, { type: INTEROP.AccessGrant, base: appRegResource });

  const applicationRegistration = podTable('app-reg', {
    id: id(),
    registeredAgent: uri('registeredAgent').predicate('http://www.w3.org/ns/solid/interop#registeredAgent'),
    hasAccessGrant: uri('hasAccessGrant').predicate(INTEROP.hasAccessGrant),
  }, { type: INTEROP.ApplicationRegistration, base: appRegResource });

  return { registrySet, dataGrant, accessGrant, applicationRegistration, appRegResource, registriesPath };
};

/**
 * Helper to setup a complete SAI environment for the Chat Example.
 * This simulates what an Authorization Agent would do:
 * 1. Create RegistrySet and link to Profile.
 * 2. Create an Application Registration for the 'Chat App'.
 * 3. Create an Access Grant containing a Data Grant pointing to the chat data.
 */
export async function setupSaiForExample(
  ownerSession: Session, 
  granteeClientId: string, 
  dataContainerUrl: string
) {
  const ownerPodBase = ownerSession.info.webId!.split('profile')[0];
  const sai = getSaiTables(ownerPodBase);
  const db = drizzle(ownerSession);

  // 1. RegistrySet
  const setId = 'set-chat-example';
  // Clean old data
  try {
      await ownerSession.fetch(`${sai.registriesPath}set.ttl`, { method: 'DELETE' });
      await ownerSession.fetch(sai.appRegResource, { method: 'DELETE' });
  } catch {}

  // Ensure container
  await ownerSession.fetch(sai.registriesPath, { method: 'PUT', headers: { 'Content-Type': 'text/turtle' } }).catch(() => {});

  await db.insert(sai.registrySet).values({
      id: setId,
      hasAgentRegistry: [`${sai.registriesPath}agents/`]
  });

  // Link to Profile using N3 Patch (More robust against CSS SPARQL Update quirks)
  const profileUrl = ownerSession.info.webId!.split('#')[0];
  const targetSetUrl = `${sai.registriesPath}set.ttl#${setId}`;
  const patchBody = `
    @prefix solid: <http://www.w3.org/ns/solid/terms#>.
    @prefix interop: <http://www.w3.org/ns/solid/interop#>.
    _:patch a solid:InsertDeletePatch;
      solid:inserts { <${ownerSession.info.webId}> interop:hasRegistrySet <${targetSetUrl}> . } .
  `;
  
  try {
      await ownerSession.fetch(profileUrl, { 
          method: 'PATCH', 
          headers: { 'Content-Type': 'text/n3' },
          body: patchBody
      });
  } catch (e) {
      console.warn('Profile update failed (SAI setup)', e);
      throw e; // Critical failure
  }

  // 2. Grants
  await ownerSession.fetch(sai.appRegResource, { method: 'PUT', headers: { 'Content-Type': 'text/turtle' }, body: '' }).catch(() => {});
  
  const grantId = 'grant-chat';
  const dataGrantId = 'grant-chat-data';

  await db.insert(sai.dataGrant).values({
      id: dataGrantId,
      hasDataRegistration: dataContainerUrl,
      registeredShapeTree: 'http://localhost:3000/test/shapes/message-tree.ttl', // Dummy
      scopeOfGrant: 'http://www.w3.org/ns/solid/interop#AllFromRegistry'
  });

  await db.insert(sai.accessGrant).values({
      id: grantId,
      hasDataGrant: [`${sai.appRegResource}#${dataGrantId}`]
  });

  await db.insert(sai.applicationRegistration).values({
      id: 'app-chat',
      registeredAgent: granteeClientId,
      hasAccessGrant: `${sai.appRegResource}#${grantId}`
  });
  
  console.log(`✅ SAI Environment setup complete for ${ownerSession.info.webId}`);
}
