import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Parser } from 'n3';
import { drizzle, id, object, podTable, string } from '../../../src/index';
import { buildTestPodUrl, createTestSession, ensureContainer, resetSharedSession } from './helpers';

const containerPath = `/inline-object-isolation-${Date.now()}/`;
const base = buildTestPodUrl(containerPath);
const ns = 'https://example.org/task/';
const tasks = podTable('inlineTasks', {
  id: id('id').default('index.ttl#{key}'),
  title: string('title').predicate(`${ns}title`),
  metadata: object('metadata').predicate(`${ns}metadata`),
}, { base, type: `${ns}Task`, namespace: { prefix: 'task', uri: ns } });

describe('inline metadata isolation within one real Pod document', () => {
  let session: Awaited<ReturnType<typeof createTestSession>>;
  let db: ReturnType<typeof drizzle>;
  beforeAll(async () => {
    session = await createTestSession();
    await ensureContainer(session, containerPath);
    db = drizzle(session, { podUrl: buildTestPodUrl('/'), schema: { tasks }, resourcePreparation: 'off' });
  });
  afterAll(async () => {
    if (session) {
      await session.fetch(`${base}index.ttl`, { method: 'DELETE' });
      await session.fetch(base, { method: 'DELETE' });
    }
    await resetSharedSession();
  });

  it('keeps two Tasks separate through insert, read, update and delete', async () => {
    const first = { authBinding: { id: 'first-grant' }, xpod: { triggerKind: 'interval', intervalSeconds: 60 } };
    const second = { authBinding: { id: 'second-grant' }, xpod: { triggerKind: 'interval', intervalSeconds: 3600 } };
    await db.insert(tasks).values({ id: 'index.ttl#first', title: 'First', metadata: first });
    await db.insert(tasks).values({ id: 'index.ttl#second', title: 'Second', metadata: second });
    expect((await db.findById(tasks, 'index.ttl#first'))?.metadata).toMatchObject(first);
    expect((await db.findById(tasks, 'index.ttl#second'))?.metadata).toMatchObject(second);

    const response = await session.fetch(`${base}index.ttl`, { headers: { accept: 'text/turtle' } });
    expect(response.status).toBe(200);
    const graph = new Parser({ baseIRI: `${base}index.ttl` }).parse(await response.text());
    const children = graph.filter(quad => quad.predicate.value === `${ns}metadata`).map(quad => quad.object.value);
    expect(children).toHaveLength(2);
    expect(new Set(children).size).toBe(2);

    const changed = { authBinding: { id: 'first-new-grant' }, xpod: { triggerKind: 'interval', intervalSeconds: 120 } };
    await db.updateById(tasks, 'index.ttl#first', { metadata: changed });
    expect((await db.findById(tasks, 'index.ttl#first'))?.metadata).toMatchObject(changed);
    expect((await db.findById(tasks, 'index.ttl#second'))?.metadata).toMatchObject(second);
    await db.deleteById(tasks, 'index.ttl#first');
    expect(await db.findById(tasks, 'index.ttl#first')).toBeNull();
    expect((await db.findById(tasks, 'index.ttl#second'))?.metadata).toMatchObject(second);
  });
});
