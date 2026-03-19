/**
 * Drizzle ORM TYPE parity tests
 * Adapted from Drizzle ORM parity selection for Solid dialect.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  text,
  varchar,
  char,
  int,
  bigint as bigintColumn,
  boolean,
  date,
  datetime,
  timestamp,
  json,
  uri,
  object,
  eq,
  and,
  inArray,
  notInArray,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const runId = Date.now();
const containerPath = `/drizzle-types-${runId}/`;
const namespace = {
  prefix: 'app',
  uri: 'https://example.org/ns#',
};

vi.setConfig({ testTimeout: 60_000 });

const ScalarTypesTable = podTable('ScalarTypeParity', {
  id: string('id').primaryKey().predicate('http://schema.org/identifier'),
  textValue: text('textValue').predicate('http://schema.org/description'),
  varcharValue: varchar('varcharValue').predicate('http://schema.org/alternateName'),
  charValue: char('charValue').predicate('http://schema.org/additionalName'),
  countValue: int('countValue').predicate('http://schema.org/value'),
  bigCount: bigintColumn('bigCount').predicate('https://example.org/ns#bigCount'),
  enabled: boolean('enabled').predicate('https://example.org/ns#enabled'),
  metadata: json('metadata').predicate('https://example.org/ns#metadata'),
  createdOn: date('createdOn').predicate('http://schema.org/dateCreated'),
  updatedAt: datetime('updatedAt').predicate('http://schema.org/dateModified'),
  publishedAt: timestamp('publishedAt').predicate('http://schema.org/datePublished'),
}, {
  type: 'http://schema.org/Thing',
  base: `${buildTestPodUrl(containerPath)}scalar-types.ttl`,
  subjectTemplate: '#{id}',
});

const DefaultsTable = podTable('DefaultTypeParity', {
  id: string('id').primaryKey().predicate('http://schema.org/identifier'),
  label: string('label').predicate('http://schema.org/name').default('auto-label'),
  status: string('status').predicate('https://example.org/ns#status').default('draft'),
  enabled: boolean('enabled').predicate('https://example.org/ns#enabled').default(false),
  createdAt: timestamp('createdAt').predicate('http://schema.org/dateCreated').defaultNow(),
  slug: string('slug').predicate('https://example.org/ns#slug').default(() => `slug-${Date.now()}`),
}, {
  type: 'http://schema.org/Thing',
  base: `${buildTestPodUrl(containerPath)}defaults.ttl`,
  subjectTemplate: '#{id}',
});

const ArrayTypesTable = podTable('ArrayTypeParity', {
  id: string('id').primaryKey().predicate('http://schema.org/identifier'),
  label: string('label').predicate('http://schema.org/name'),
  tags: string('tags').array().predicate('http://schema.org/keywords'),
  links: uri('links').array().predicate('http://schema.org/sameAs'),
}, {
  type: 'http://schema.org/Thing',
  base: `${buildTestPodUrl(containerPath)}array-types.ttl`,
  subjectTemplate: '#{id}',
});

const DocumentModelsTable = podTable('DocumentModelParity', {
  id: string('id').primaryKey(),
  enabled: boolean('enabled').predicate(`${namespace.uri}enabled`),
  models: object('models').array().predicate(`${namespace.uri}models`),
}, {
  type: `${namespace.uri}ModelProvider`,
  base: `${buildTestPodUrl(containerPath)}document-models/`,
  namespace,
  subjectTemplate: '{id}.ttl#this',
});

describe('Drizzle ORM TYPE parity tests', () => {
  let session: Session;
  let db: SolidDatabase;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);
    await ensureContainer(session, `${containerPath}document-models/`);
  }, 120_000);

  test('all scalar aliases roundtrip', async () => {
    const input = {
      id: 'scalar-1',
      textValue: 'Long form text value',
      varcharValue: 'display-name',
      charValue: 'Z',
      countValue: 42,
      bigCount: 9_007_199_254_740_991,
      enabled: true,
      metadata: {
        provider: 'openai',
        tier: 'pro',
        flags: ['beta', 'stable'],
      },
      createdOn: new Date('2024-01-02T03:04:05.678Z'),
      updatedAt: new Date('2024-05-06T07:08:09.123Z'),
      publishedAt: new Date('2024-09-10T11:12:13.456Z'),
    };

    await db.insert(ScalarTypesTable).values(input);

    const row = await db.findByLocator(ScalarTypesTable, { id: input.id });
    expect(row).not.toBeNull();
    expect(row.id).toBe(input.id);
    expect(row.textValue).toBe(input.textValue);
    expect(row.varcharValue).toBe(input.varcharValue);
    expect(row.charValue).toBe(input.charValue);
    expect(row.countValue).toBe(input.countValue);
    expect(row.bigCount).toBe(input.bigCount);
    expect(row.enabled).toBe(true);
    expect(row.metadata).toMatchObject({
      provider: 'openai',
      tier: 'pro',
    });
    expect(Array.isArray(row.metadata?.flags)).toBe(true);
    expect(row.metadata?.flags).toContain('beta');
    expect(row.createdOn).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.createdOn?.toISOString()).toBe(input.createdOn.toISOString());
    expect(row.updatedAt?.toISOString()).toBe(input.updatedAt.toISOString());
    expect(row.publishedAt?.toISOString()).toBe(input.publishedAt.toISOString());
  });

  test('$default function should apply dynamic values on insert', async () => {
    await db.insert(DefaultsTable).values({
      id: 'default-fn-1',
    });

    const row = await db.findByLocator(DefaultsTable, { id: 'default-fn-1' });
    expect(row).not.toBeNull();
    expect(row?.slug).toMatch(/^slug-/);
  });

  test('default values should be applied on insert', async () => {
    await db.insert(DefaultsTable).values({
      id: 'default-1',
    });

    const row = await db.findByLocator(DefaultsTable, { id: 'default-1' });
    expect(row).not.toBeNull();
    expect(row.label).toBe('auto-label');
    expect(row.status).toBe('draft');
    expect(row.enabled).toBe(false);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.slug).toMatch(/^slug-/);
  });

  test('overridden default values should win over schema defaults', async () => {
    const customDate = new Date('2025-02-03T04:05:06.789Z');

    await db.insert(DefaultsTable).values({
      id: 'default-2',
      label: 'manual-label',
      status: 'published',
      enabled: true,
      createdAt: customDate,
    });

    const row = await db.findByLocator(DefaultsTable, { id: 'default-2' });
    expect(row).not.toBeNull();
    expect(row.label).toBe('manual-label');
    expect(row.status).toBe('published');
    expect(row.enabled).toBe(true);
    expect(row.createdAt?.toISOString()).toBe(customDate.toISOString());
    expect(row.slug).toMatch(/^slug-/);
  });

  test('select large integer should preserve bigint alias semantics', async () => {
    await db.insert(ScalarTypesTable).values({
      id: 'bigint-select-1',
      bigCount: 9_007_199_254_740_991,
    });

    const row = await db.findByLocator(ScalarTypesTable, { id: 'bigint-select-1' });
    expect(row).not.toBeNull();
    expect(row?.bigCount).toBe(9_007_199_254_740_991);
  });

  test('string values with spaces should roundtrip exactly', async () => {
    await db.insert(ScalarTypesTable).values({
      id: 'spaces-1',
      textValue: 'value with  double  spaces',
      varcharValue: 'display name with spaces',
      charValue: 'S',
      metadata: { note: 'keeps spaces' },
    });

    const row = await db.findByLocator(ScalarTypesTable, { id: 'spaces-1' });
    expect(row).not.toBeNull();
    expect(row?.textValue).toBe('value with  double  spaces');
    expect(row?.varcharValue).toBe('display name with spaces');
  });

  test('timestamp values should normalize timezone offsets', async () => {
    const zonedDate = new Date('2024-12-31T23:30:00.000+08:00');

    await db.insert(ScalarTypesTable).values({
      id: 'timezone-1',
      publishedAt: zonedDate,
    });

    const row = await db.findByLocator(ScalarTypesTable, { id: 'timezone-1' });
    expect(row).not.toBeNull();
    expect(row?.publishedAt).toBeInstanceOf(Date);
    expect(row?.publishedAt?.toISOString()).toBe(zonedDate.toISOString());
  });

  test('char field should support update and delete workflows', async () => {
    await db.insert(ScalarTypesTable).values({
      id: 'char-flow-1',
      charValue: 'A',
    });

    await db.updateByLocator(ScalarTypesTable, { id: 'char-flow-1' }, { charValue: 'B' });

    const updatedRow = await db.findByLocator(ScalarTypesTable, { id: 'char-flow-1' });
    expect(updatedRow).not.toBeNull();
    expect(updatedRow?.charValue).toBe('B');

    await db.delete(ScalarTypesTable)
      .where(eq(ScalarTypesTable.charValue, 'B'));

    const remainingRow = await db.findByLocator(ScalarTypesTable, { id: 'char-flow-1' });
    expect(remainingRow).toBeNull();
  });

  test('boolean filters should preserve eq semantics', async () => {
    await db.insert(ScalarTypesTable).values([
      {
        id: 'bool-1',
        textValue: 'enabled row',
        enabled: true,
      },
      {
        id: 'bool-2',
        textValue: 'disabled row',
        enabled: false,
      },
    ]);

    const enabledRows = await db.select().from(ScalarTypesTable)
      .where(eq(ScalarTypesTable.enabled, true));
    const disabledRows = await db.select().from(ScalarTypesTable)
      .where(eq(ScalarTypesTable.enabled, false));

    expect(enabledRows.some((row) => row.id === 'bool-1')).toBe(true);
    expect(enabledRows.every((row) => row.enabled === true)).toBe(true);
    expect(disabledRows.some((row) => row.id === 'bool-2')).toBe(true);
    expect(disabledRows.every((row) => row.enabled === false)).toBe(true);
  });

  test('select with empty array in inArray should return no rows', async () => {
    await db.insert(ScalarTypesTable).values({
      id: 'empty-in-array-1',
      textValue: 'Empty In Array',
    });

    const rows = await db.select().from(ScalarTypesTable)
      .where(inArray(ScalarTypesTable.textValue, []));

    expect(rows).toHaveLength(0);
  });

  test('select with empty array in notInArray should keep rows', async () => {
    await db.insert(ScalarTypesTable).values([
      { id: 'empty-not-in-array-1', textValue: 'Keep 1' },
      { id: 'empty-not-in-array-2', textValue: 'Keep 2' },
    ]);

    const rows = await db.select().from(ScalarTypesTable)
      .where(and(
        notInArray(ScalarTypesTable.textValue, []),
        inArray(ScalarTypesTable.textValue, ['Keep 1', 'Keep 2'])
      ));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id).sort()).toEqual(['empty-not-in-array-1', 'empty-not-in-array-2']);
  });

  test('array mapping and parsing should roundtrip string and uri arrays', async () => {
    const input = {
      id: 'array-1',
      label: 'array-label-1',
      tags: ['alpha', 'beta', 'gamma'],
      links: [
        'https://example.org/resources/a',
        'https://example.org/resources/b',
      ],
    };

    await db.insert(ArrayTypesTable).values(input);

    const rows = await db.select().from(ArrayTypesTable)
      .where(eq(ArrayTypesTable.label, input.label));

    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(Array.isArray(row.tags)).toBe(true);
    expect(Array.isArray(row.links)).toBe(true);
    expect([...(row.tags ?? [])].sort()).toEqual([...input.tags].sort());
    expect([...(row.links ?? [])].sort()).toEqual([...input.links].sort());
  });

  test('object array roundtrip should work in document mode', async () => {
    await db.insert(DocumentModelsTable).values({
      id: 'provider-1',
      enabled: true,
      models: [
        { name: 'gpt-4o-mini', maxTokens: 8192, active: true },
        { name: 'gpt-4.1', maxTokens: 16384, active: false },
      ],
    });

    const row = await db.findByLocator(DocumentModelsTable, { id: 'provider-1' });
    expect(row).not.toBeNull();
    expect(row.enabled).toBe(true);
    expect(Array.isArray(row.models)).toBe(true);
    expect(row.models).toHaveLength(2);

    const models = [...(row.models ?? [])]
      .map((model: any) => ({
        name: model.name,
        maxTokens: model.maxTokens,
        active: model.active,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(models).toEqual([
      { name: 'gpt-4.1', maxTokens: 16384, active: false },
      { name: 'gpt-4o-mini', maxTokens: 8192, active: true },
    ]);
  });
});
