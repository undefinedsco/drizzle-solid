import { beforeAll, describe, expect, it } from 'vitest';
import { ASTToSPARQLConverter } from '../../../src/core/ast-to-sparql';
import { drizzle } from '../../../src/driver';
import { podTable, string, timestamp, boolean, uri } from '../../../src/core/schema';
import { eq, inArray } from '../../../src/core/query-conditions';
import { createTestSession, ensureContainer } from './helpers';

describe('Exact subject lookup regression', () => {
  let session: any;
  let podBase: string;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
  }, 60_000);

  it('keeps single-id lookup on wide table as FILTER, not VALUES', async () => {
    const containerPath = `data/exact-lookup-10opt-${Date.now()}/`;
    const baseContainer = `${podBase}${containerPath}`;
    const sparqlEndpoint = `${baseContainer}-/sparql`;
    await ensureContainer(session, containerPath);

    const testTable = podTable('test', {
      id: string('id').primaryKey(),
      name: string('name').predicate('http://schema.org/name').notNull(),
      opt1: string('opt1').predicate('http://example.org/opt1'),
      opt2: string('opt2').predicate('http://example.org/opt2'),
      opt3: string('opt3').predicate('http://example.org/opt3'),
      opt4: string('opt4').predicate('http://example.org/opt4'),
      opt5: string('opt5').predicate('http://example.org/opt5'),
      opt6: string('opt6').predicate('http://example.org/opt6'),
      opt7: string('opt7').predicate('http://example.org/opt7'),
      opt8: string('opt8').predicate('http://example.org/opt8'),
      opt9: string('opt9').predicate('http://example.org/opt9'),
      opt10: string('opt10').predicate('http://example.org/opt10'),
    }, {
      type: 'http://schema.org/Thing',
      base: baseContainer,
      subjectTemplate: '{id}.ttl',
      sparqlEndpoint,
    });

    const db = drizzle(session);
    const id = `test-${Date.now()}`;
    await db.insert(testTable).values({ id, name: 'Test Item' });

    const converter = new ASTToSPARQLConverter(podBase);
    const query = converter.convertSimpleSelect(
      { table: testTable, where: eq(testTable.id, id) as any },
      undefined,
      undefined,
      false,
    ).query;

    expect(query).toContain('FILTER(?subject =');
    expect(query).not.toContain('VALUES ?subject');

    const start = Date.now();
    const results = await db.select().from(testTable).where(eq(testTable.id, id));
    const duration = Date.now() - start;

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Test Item');
    expect(duration).toBeLessThan(3000);
  }, 30_000);

  it('keeps single-id lookup on 13 OPTIONAL contact table stable', async () => {
    const containerPath = `data/exact-lookup-contact-${Date.now()}/`;
    const baseContainer = `${podBase}${containerPath}`;
    const sparqlEndpoint = `${baseContainer}-/sparql`;
    await ensureContainer(session, containerPath);

    const contactTable = podTable('contact', {
      id: string('id').primaryKey(),
      name: string('name').predicate('http://www.w3.org/2006/vcard/ns#fn').notNull(),
      entityUri: uri('entityUri').predicate('http://xmlns.com/foaf/0.1/primaryTopic').notNull(),
      contactType: string('contactType').predicate('https://undefineds.co/ns#contactType').notNull(),
      createdAt: timestamp('createdAt').predicate('http://purl.org/dc/terms/created').notNull(),
      updatedAt: timestamp('updatedAt').predicate('http://purl.org/dc/terms/modified').notNull(),
      avatarUrl: uri('avatarUrl').predicate('http://www.w3.org/2006/vcard/ns#hasPhoto'),
      isPublic: boolean('isPublic').predicate('https://www.w3.org/ns/activitystreams#audience'),
      externalPlatform: string('externalPlatform').predicate('https://undefineds.co/ns#externalPlatform'),
      externalId: string('externalId').predicate('https://undefineds.co/ns#externalId'),
      alias: string('alias').predicate('https://undefineds.co/ns#alias'),
      starred: boolean('starred').predicate('https://undefineds.co/ns#favorite'),
      note: string('note').predicate('http://www.w3.org/2006/vcard/ns#note'),
      sortKey: string('sortKey').predicate('https://undefineds.co/ns#sortKey'),
      gender: string('gender').predicate('http://www.w3.org/2006/vcard/ns#hasGender'),
      province: string('province').predicate('http://www.w3.org/2006/vcard/ns#region'),
      city: string('city').predicate('http://www.w3.org/2006/vcard/ns#locality'),
      deletedAt: timestamp('deletedAt').predicate('https://undefineds.co/ns#deletedAt'),
      lastSyncedAt: timestamp('lastSyncedAt').predicate('https://undefineds.co/ns#lastSyncedAt'),
    }, {
      type: 'http://www.w3.org/2006/vcard/ns#Individual',
      base: baseContainer,
      subjectTemplate: '{id}.ttl',
      sparqlEndpoint,
    });

    const db = drizzle(session);
    const id = `contact-${Date.now()}`;
    await db.insert(contactTable).values({
      id,
      name: 'Test Contact',
      entityUri: 'urn:test',
      contactType: 'solid',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const converter = new ASTToSPARQLConverter(podBase);
    const query = converter.convertSimpleSelect(
      { table: contactTable, where: eq(contactTable.id, id) as any },
      undefined,
      undefined,
      false,
    ).query;

    expect(query).toContain('FILTER(?subject =');
    expect(query).not.toContain('VALUES ?subject');

    const start = Date.now();
    const results = await db.select().from(contactTable).where(eq(contactTable.id, id));
    const duration = Date.now() - start;

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Test Contact');
    expect(duration).toBeLessThan(3000);
  }, 30_000);

  it('still uses VALUES for multi-id lookups', async () => {
    const containerPath = `data/exact-lookup-multi-${Date.now()}/`;
    const baseContainer = `${podBase}${containerPath}`;
    const sparqlEndpoint = `${baseContainer}-/sparql`;
    await ensureContainer(session, containerPath);

    const testTable = podTable('test', {
      id: string('id').primaryKey(),
      name: string('name').predicate('http://schema.org/name').notNull(),
    }, {
      type: 'http://schema.org/Thing',
      base: baseContainer,
      subjectTemplate: '{id}.ttl',
      sparqlEndpoint,
    });

    const db = drizzle(session);
    const ids = [`multi-a-${Date.now()}`, `multi-b-${Date.now()}`];
    await db.insert(testTable).values(ids.map((id, index) => ({
      id,
      name: `Item ${index + 1}`,
    })));

    const converter = new ASTToSPARQLConverter(podBase);
    const query = converter.convertSimpleSelect(
      { table: testTable, where: inArray(testTable.id, ids) as any },
      undefined,
      undefined,
      false,
    ).query;

    expect(query).toContain('VALUES ?subject');
    expect(query).not.toContain('FILTER(?subject IN');

    const results = await db.select().from(testTable).where(inArray(testTable.id, ids));
    expect(results).toHaveLength(2);
  }, 30_000);
});
