import { describe, it, expect, beforeAll } from 'vitest';
import { createTestSession, ensureContainer } from './helpers';
import { drizzle } from '../../../src/driver';
import { podTable, string, timestamp, boolean, uri } from '../../../src/core/schema';
import { eq } from '../../../src/core/query-conditions';

/**
 * FILTER + OPTIONAL Hang Bug Reproduction
 *
 * Issue: xpod's ComunicaQuintEngine hangs when processing SPARQL queries with:
 * - FILTER(?subject = <...>)
 * - 10+ OPTIONAL clauses
 *
 * Threshold found:
 * - 0-7 OPTIONALs: Works (7 OPTIONALs ~529ms)
 * - 10+ OPTIONALs: Hangs/times out
 *
 * Root cause: OPTIONAL optimization path in ComunicaQuintEngine becomes exponentially
 * slower with FILTER, eventually deadlocking.
 */

describe('FILTER + OPTIONAL Hang Bug', () => {
  let session: any;
  let podBase: string;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
  }, 60000);

  // Test with 5 OPTIONALs - should work
  it('should handle FILTER + 5 OPTIONALs (below threshold)', async () => {
    const containerPath = `data/filter-test-5opt-${Date.now()}/`;
    const baseContainer = `${podBase}${containerPath}`;
    const sparqlEndpoint = `${baseContainer}-/sparql`;

    await ensureContainer(session, containerPath);

    // Table with 5 optional columns
    const testTable = podTable('test', {
      id: string('id').primaryKey(),
      name: string('name').predicate('http://schema.org/name').notNull(),
      opt1: string('opt1').predicate('http://example.org/opt1'),
      opt2: string('opt2').predicate('http://example.org/opt2'),
      opt3: string('opt3').predicate('http://example.org/opt3'),
      opt4: string('opt4').predicate('http://example.org/opt4'),
      opt5: string('opt5').predicate('http://example.org/opt5'),
    }, {
      type: 'http://schema.org/Thing',
      base: baseContainer,
      subjectTemplate: '{id}.ttl',
      sparqlEndpoint
    });

    const db = drizzle(session);

    // INSERT
    const id = `test-${Date.now()}`;
    await db.insert(testTable).values({ id, name: 'Test Item' });

    // SELECT with WHERE (generates FILTER)
    const start = Date.now();
    const results = await db.select().from(testTable).where(eq(testTable.id, id));
    const duration = Date.now() - start;

    console.log(`5 OPTIONALs: ${duration}ms`);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Test Item');
    expect(duration).toBeLessThan(5000); // Should complete quickly
  }, 15000);

  // Test with 7 OPTIONALs - should work but slower
  it('should handle FILTER + 7 OPTIONALs (near threshold)', async () => {
    const containerPath = `data/filter-test-7opt-${Date.now()}/`;
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
    }, {
      type: 'http://schema.org/Thing',
      base: baseContainer,
      subjectTemplate: '{id}.ttl',
      sparqlEndpoint
    });

    const db = drizzle(session);

    const id = `test-${Date.now()}`;
    await db.insert(testTable).values({ id, name: 'Test Item' });

    const start = Date.now();
    const results = await db.select().from(testTable).where(eq(testTable.id, id));
    const duration = Date.now() - start;

    console.log(`7 OPTIONALs: ${duration}ms`);
    expect(results.length).toBe(1);
    expect(duration).toBeLessThan(5000);
  }, 15000);

  // Test with 10 OPTIONALs - EXPECTED TO HANG/TIMEOUT
  it('should HANG with FILTER + 10 OPTIONALs (above threshold)', async () => {
    const containerPath = `data/filter-test-10opt-${Date.now()}/`;
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
      sparqlEndpoint
    });

    const db = drizzle(session);

    const id = `test-${Date.now()}`;
    await db.insert(testTable).values({ id, name: 'Test Item' });

    // This will hang/timeout
    const start = Date.now();
    try {
      const results = await db.select().from(testTable).where(eq(testTable.id, id));
      const duration = Date.now() - start;
      console.log(`10 OPTIONALs: ${duration}ms (UNEXPECTED SUCCESS)`);
      expect(results.length).toBe(1);
    } catch (e) {
      const duration = Date.now() - start;
      console.log(`10 OPTIONALs: TIMEOUT after ${duration}ms (EXPECTED)`);
      throw e;
    }
  }, 15000);

  // Test with 13 OPTIONALs (real-world contact table) - EXPECTED TO HANG
  it('should HANG with FILTER + 13 OPTIONALs (contact table)', async () => {
    const containerPath = `data/filter-test-contact-${Date.now()}/`;
    const baseContainer = `${podBase}${containerPath}`;
    const sparqlEndpoint = `${baseContainer}-/sparql`;

    await ensureContainer(session, containerPath);

    // Simplified contact table schema
    const contactTable = podTable('contact', {
      id: string('id').primaryKey(),
      name: string('name').predicate('http://www.w3.org/2006/vcard/ns#fn').notNull(),
      entityUri: uri('entityUri').predicate('http://xmlns.com/foaf/0.1/primaryTopic').notNull(),
      contactType: string('contactType').predicate('https://undefineds.co/ns#contactType').notNull(),
      createdAt: timestamp('createdAt').predicate('http://purl.org/dc/terms/created').notNull(),
      updatedAt: timestamp('updatedAt').predicate('http://purl.org/dc/terms/modified').notNull(),
      // 13 optional columns
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
      sparqlEndpoint
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

    // This will hang/timeout
    const start = Date.now();
    try {
      const results = await db.select().from(contactTable).where(eq(contactTable.id, id));
      const duration = Date.now() - start;
      console.log(`13 OPTIONALs: ${duration}ms (UNEXPECTED SUCCESS)`);
      expect(results.length).toBe(1);
    } catch (e) {
      const duration = Date.now() - start;
      console.log(`13 OPTIONALs: TIMEOUT after ${duration}ms (EXPECTED)`);
      throw e;
    }
  }, 15000);

  // Workaround test: SELECT without WHERE (no FILTER)
  it('should work with 13 OPTIONALs when NO FILTER is used', async () => {
    const containerPath = `data/filter-test-nofilter-${Date.now()}/`;
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
      sparqlEndpoint
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

    // SELECT without WHERE - no FILTER generated
    const start = Date.now();
    const results = await db.select().from(contactTable);
    const duration = Date.now() - start;

    console.log(`13 OPTIONALs (no FILTER): ${duration}ms`);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.find(r => r.id === id)).toBeDefined();
    expect(duration).toBeLessThan(5000); // Should work fine without FILTER
  }, 15000);
});
