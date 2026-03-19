/**
 * Drizzle ORM mapped template tests
 * Adapted from parity mapping output into executable Solid integration coverage.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  datetime,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = `/drizzle-mapped-${timestamp}/`;
const baseUrl = `${buildTestPodUrl(containerPath)}`;

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM Mapped Tests', () => {
  let session: Session;
  let db: SolidDatabase;

  const FragmentTable = podTable('MappedFragment', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${baseUrl}fragment/index.ttl`,
    subjectTemplate: '#{id}',
  });

  const DocumentTable = podTable('MappedDocument', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    name: string('name').notNull().predicate('http://schema.org/name'),
  }, {
    type: 'http://schema.org/Thing',
    base: `${baseUrl}document/`,
    subjectTemplate: '{id}.ttl',
  });

  const MultiVarTable = podTable('MappedMultiVar', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    chatId: string('chatId').notNull().predicate('http://schema.org/chatId'),
    name: string('name').notNull().predicate('http://schema.org/name'),
  }, {
    type: 'http://schema.org/Message',
    base: `${baseUrl}multi/`,
    subjectTemplate: '{chatId}/{id}.ttl',
  });

  const DatePartitionedTable = podTable('MappedDatePartitioned', {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    chatId: string('chatId').notNull().predicate('http://schema.org/chatId'),
    createdAt: datetime('createdAt').notNull().predicate('http://schema.org/dateCreated'),
    name: string('name').notNull().predicate('http://schema.org/name'),
  }, {
    type: 'http://schema.org/Message',
    base: `${baseUrl}dated/`,
    subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/{id}.ttl',
  });

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);
    await ensureContainer(session, `${containerPath}fragment/`);
    await ensureContainer(session, `${containerPath}document/`);
    await ensureContainer(session, `${containerPath}multi/`);
    await ensureContainer(session, `${containerPath}dated/`);
  }, 120_000);

  test('Template: #{id}', async () => {
    await db.insert(FragmentTable).values({ id: 'fragment-1', name: 'Fragment Item' });

    const record = await db.findByLocator(FragmentTable, { id: 'fragment-1' });
    expect(record).not.toBeNull();
    expect(record?.name).toBe('Fragment Item');
  });

  test('Template: {id}.ttl', async () => {
    await db.insert(DocumentTable).values({ id: 'document-1', name: 'Document Item' });

    const record = await db.findByLocator(DocumentTable, { id: 'document-1' });
    expect(record).not.toBeNull();
    expect(record?.name).toBe('Document Item');
  });

  test('Template: {chatId}/{id}.ttl', async () => {
    await db.insert(MultiVarTable).values({
      id: 'message-1',
      chatId: 'chat-1',
      name: 'Thread Message',
    });

    const record = await db.findByLocator(MultiVarTable, {
      chatId: 'chat-1',
      id: 'message-1',
    });
    expect(record).not.toBeNull();
    expect(record?.name).toBe('Thread Message');
  });

  test('Template: {chatId}/{yyyy}/{MM}/{dd}/{id}.ttl', async () => {
    await db.insert(DatePartitionedTable).values({
      id: 'dated-1',
      chatId: 'chat-2',
      createdAt: new Date('2026-03-05T10:00:00Z'),
      name: 'Partitioned Message',
    });

    const fullUri = `${baseUrl}dated/chat-2/2026/03/05/dated-1.ttl`;
    const record = await db.findByIri(DatePartitionedTable, fullUri);

    expect(record).not.toBeNull();
    expect(record?.name).toBe('Partitioned Message');
  });
});
