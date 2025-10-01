import { afterAll, afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { getSolidDataset, getThing, removeThing, saveSolidDatasetAt } from '@inrupt/solid-client';
import { TypeIndexManager, type TypeIndexEntry } from '@src/core/typeindex-manager';
import type { Session } from '@inrupt/solid-client-authn-node';
import { createTestSession, ensureContainer } from './helpers';

const typeIndexCleanupTargets: Array<{ url: string; thingUrl: string }> = [];
const containerPath = `/typeindex-tests/${Date.now()}/`;

describe('CSS integration: TypeIndexManager', () => {
  let session: Session;
  let manager: TypeIndexManager;
  let typeIndexUrl: string;
  let registeredContainerUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    const fetchFn = session.fetch.bind(session);
    const webId = session.info.webId!;
    manager = new TypeIndexManager(webId, process.env.SOLID_TEST_POD_BASE || derivePodBaseFromWebId(webId), fetchFn);

    registeredContainerUrl = await ensureContainer(session, containerPath);
    typeIndexUrl = await manager.findTypeIndex();

    if (!typeIndexUrl) {
      typeIndexUrl = await manager.createTypeIndex();
    }
  }, 120_000);

  afterEach(async () => {
    for (const { url, thingUrl } of typeIndexCleanupTargets.splice(0)) {
      await cleanupTypeIndexEntry(session, url, thingUrl);
    }
  });

  afterAll(async () => {
    if (session) {
      await session.logout().catch(() => undefined);
    }
  });

  test('registers and discovers a type registration', async () => {
    const timestamp = Date.now();
    const entry: TypeIndexEntry = {
      rdfClass: `https://example.com/vocab#TestPerson-${timestamp}`,
      containerPath,
      forClass: `TestPerson${timestamp}`
    };

    await manager.registerType(entry, typeIndexUrl);

    const entryFragment = `${typeIndexUrl}#${entry.forClass.toLowerCase()}`;
    typeIndexCleanupTargets.push({ url: typeIndexUrl, thingUrl: entryFragment });

    const discovered = await manager.discoverTypes(typeIndexUrl);
    const match = discovered.find((candidate) => candidate.rdfClass === entry.rdfClass);

    expect(match).toBeDefined();
    expect(match?.containerPath).toBe(containerPath);
  }, 120_000);
});

async function cleanupTypeIndexEntry(session: Session, typeIndexUrl: string, thingUrl: string): Promise<void> {
  try {
    const dataset = await getSolidDataset(typeIndexUrl, { fetch: session.fetch.bind(session) });
    const thing = getThing(dataset, thingUrl);
    if (!thing) return;
    const updated = removeThing(dataset, thing);
    await saveSolidDatasetAt(typeIndexUrl, updated, { fetch: session.fetch.bind(session) });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[cleanup] failed to remove type index entry ${thingUrl}:`, error);
  }
}

function derivePodBaseFromWebId(webId: string): string {
  const url = new URL(webId);
  url.hash = '';
  const segments = url.pathname.split('/').filter(Boolean);
  const podSegment = segments[0] ? `${segments[0]}/` : '';
  url.pathname = `/${podSegment}`;
  return url.toString();
}
