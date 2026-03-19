/**
 * CRUD behavior across fragment mode and plain-LDP document mode.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  eq,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/drizzle-crud-${timestamp}/`;
const baseUrl = buildTestPodUrl(containerPath);

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM CRUD Tests', () => {
  let session: Session;
  let db: SolidDatabase;
  const fragmentIds = new Set<string>();
  const documentIds = new Set<string>();
  const multiVarLocators = new Set<string>();

  const trackFragment = <T extends { id: string }>(record: T): T => {
    fragmentIds.add(record.id);
    return record;
  };

  const trackDocument = <T extends { id: string }>(record: T): T => {
    documentIds.add(record.id);
    return record;
  };

  const trackMultiVar = <T extends { id: string; chatId: string }>(record: T): T => {
    multiVarLocators.add(`${record.chatId}:${record.id}`);
    return record;
  };

  const FragmentTable = podTable('FragmentTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    value: int('value').predicate('http://schema.org/value'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${baseUrl}fragment/index.ttl`,
    subjectTemplate: '#{id}',
  });

  const DocumentTable = podTable('DocumentTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    value: int('value').predicate('http://schema.org/value'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${baseUrl}document/`,
    subjectTemplate: '{id}.ttl',
  });

  const MultiVarTable = podTable('MultiVarTest', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    chatId: string('chatId').notNull().predicate('http://schema.org/chatId'),
    name: string('name').notNull().predicate('http://schema.org/name'),
    value: int('value').predicate('http://schema.org/value'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${baseUrl}multivar/`,
    subjectTemplate: '{chatId}/{id}.ttl',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);
    await ensureContainer(session, `${containerPath}fragment/`);
    await ensureContainer(session, `${containerPath}document/`);
    await ensureContainer(session, `${containerPath}multivar/`);
  }, 120_000);

  afterAll(async () => {
    for (const id of fragmentIds) {
      await db.deleteByLocator(FragmentTable, { id }).catch(() => undefined);
    }
    for (const id of documentIds) {
      await db.deleteByLocator(DocumentTable, { id }).catch(() => undefined);
    }
    for (const locator of multiVarLocators) {
      const [chatId, id] = locator.split(':', 2);
      await db.deleteByLocator(MultiVarTable, { chatId, id }).catch(() => undefined);
    }
  });

  test('fragment mode still supports collection queries', async () => {
    await db.insert(FragmentTable).values(trackFragment({
      id: 'fragment-1',
      name: 'Fragment One',
      value: 100,
    }));

    const results = await db.select().from(FragmentTable).where(eq(FragmentTable.name, 'Fragment One'));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'fragment-1',
      name: 'Fragment One',
      value: 100,
    });
  });

  test('document mode requires exact locator reads', async () => {
    await db.insert(DocumentTable).values(trackDocument({
      id: 'document-1',
      name: 'Document One',
      value: 200,
    }));

    const row = await db.findByLocator(DocumentTable, { id: 'document-1' });
    expect(row).toMatchObject({
      id: 'document-1',
      name: 'Document One',
      value: 200,
    });
  });

  test('multi-variable document mode requires exact locator reads', async () => {
    await db.insert(MultiVarTable).values(trackMultiVar({
      id: 'multi-1',
      chatId: 'chat-1',
      name: 'Multi One',
      value: 300,
    }));

    const row = await db.findByLocator(MultiVarTable, { chatId: 'chat-1', id: 'multi-1' });
    expect(row).toMatchObject({
      id: 'multi-1',
      chatId: 'chat-1',
      name: 'Multi One',
      value: 300,
    });
  });

  test('document mode plain-LDP collection reads should throw', async () => {
    await expect(db.select().from(DocumentTable)).rejects.toThrow(
      /Document-mode collection queries over plain LDP are not supported/i,
    );

    await expect(
      db.select().from(DocumentTable).where(eq(DocumentTable.name, 'Document One')),
    ).rejects.toThrow(/Document-mode collection queries over plain LDP are not supported/i);
  });

  test('multi-variable document mode plain-LDP collection reads should throw', async () => {
    await expect(
      db.select().from(MultiVarTable).where(eq(MultiVarTable.chatId, 'chat-1')),
    ).rejects.toThrow(/Document-mode collection queries over plain LDP are not supported/i);
  });

  test('fragment exact APIs work alongside collection reads', async () => {
    await db.insert(FragmentTable).values(trackFragment({
      id: 'fragment-exact-1',
      name: 'Fragment Exact',
      value: 400,
    }));

    const row = await db.findByLocator(FragmentTable, { id: 'fragment-exact-1' });
    expect(row).toMatchObject({
      id: 'fragment-exact-1',
      name: 'Fragment Exact',
      value: 400,
    });
  });

  test('document exact reads can also use full IRI', async () => {
    await db.insert(DocumentTable).values(trackDocument({
      id: 'document-iri-1',
      name: 'Document Iri',
      value: 500,
    }));

    const iri = `${baseUrl}document/document-iri-1.ttl`;
    const row = await db.findByIri(DocumentTable, iri);

    expect(row).toMatchObject({
      id: 'document-iri-1',
      name: 'Document Iri',
      value: 500,
      '@id': iri,
    });
  });

  test('fragment updates use exact-target APIs', async () => {
    await db.insert(FragmentTable).values(trackFragment({
      id: 'fragment-update-1',
      name: 'Before',
      value: 10,
    }));

    await db.updateByLocator(FragmentTable, { id: 'fragment-update-1' }, {
      name: 'After',
      value: 20,
    });

    const row = await db.findByLocator(FragmentTable, { id: 'fragment-update-1' });
    expect(row).toMatchObject({
      id: 'fragment-update-1',
      name: 'After',
      value: 20,
    });
  });

  test('document updates use exact-target APIs', async () => {
    await db.insert(DocumentTable).values(trackDocument({
      id: 'document-update-1',
      name: 'Before',
      value: 10,
    }));

    await db.updateByLocator(DocumentTable, { id: 'document-update-1' }, {
      name: 'After',
      value: 20,
    });

    const row = await db.findByLocator(DocumentTable, { id: 'document-update-1' });
    expect(row).toMatchObject({
      id: 'document-update-1',
      name: 'After',
      value: 20,
    });
  });

  test('multi-variable updates use exact-target APIs', async () => {
    await db.insert(MultiVarTable).values(trackMultiVar({
      id: 'multi-update-1',
      chatId: 'chat-update',
      name: 'Before',
      value: 10,
    }));

    await db.updateByLocator(MultiVarTable, { chatId: 'chat-update', id: 'multi-update-1' }, {
      name: 'After',
      value: 20,
    });

    const row = await db.findByLocator(MultiVarTable, { chatId: 'chat-update', id: 'multi-update-1' });
    expect(row).toMatchObject({
      id: 'multi-update-1',
      chatId: 'chat-update',
      name: 'After',
      value: 20,
    });
  });

  test('exact-target deletes remove only the addressed row', async () => {
    await db.insert(FragmentTable).values(trackFragment({
      id: 'fragment-delete-1',
      name: 'Delete Me',
      value: 1,
    }));
    await db.insert(DocumentTable).values(trackDocument({
      id: 'document-delete-1',
      name: 'Delete Me',
      value: 2,
    }));
    await db.insert(MultiVarTable).values(trackMultiVar({
      id: 'multi-delete-1',
      chatId: 'chat-delete',
      name: 'Delete Me',
      value: 3,
    }));

    await db.deleteByLocator(FragmentTable, { id: 'fragment-delete-1' });
    await db.deleteByLocator(DocumentTable, { id: 'document-delete-1' });
    await db.deleteByLocator(MultiVarTable, { chatId: 'chat-delete', id: 'multi-delete-1' });

    fragmentIds.delete('fragment-delete-1');
    documentIds.delete('document-delete-1');
    multiVarLocators.delete('chat-delete:multi-delete-1');

    expect(await db.findByLocator(FragmentTable, { id: 'fragment-delete-1' })).toBeNull();
    expect(await db.findByLocator(DocumentTable, { id: 'document-delete-1' })).toBeNull();
    expect(await db.findByLocator(MultiVarTable, { chatId: 'chat-delete', id: 'multi-delete-1' })).toBeNull();
  });

  test('fragment mode preserves null/undefined roundtrip behavior', async () => {
    await db.insert(FragmentTable).values(trackFragment({
      id: 'fragment-null-1',
      name: 'Null Test',
      value: null,
    }));

    const row = await db.findByLocator(FragmentTable, { id: 'fragment-null-1' });
    expect(row?.value).toBeUndefined();
  });
});
