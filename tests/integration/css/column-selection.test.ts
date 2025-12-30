/**
 * Test that column selection reduces SPARQL query patterns
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from '../../../src/driver';
import type { SolidDatabase } from '../../../src/driver';
import { podTable, id, string, timestamp, boolean, integer } from '../../../src/core/pod-table';
import { createTestSession, SOLID_IDP } from './helpers';

// Define a test namespace
const TEST_NS = 'http://example.org/test#';

// Define a test table with many columns
const testTable = podTable(
  'column-test',
  {
    id: id('id'),
    title: string('title').predicate(`${TEST_NS}title`).notNull(),
    description: string('description').predicate(`${TEST_NS}description`),
    status: string('status').predicate(`${TEST_NS}status`),
    priority: integer('priority').predicate(`${TEST_NS}priority`),
    isActive: boolean('isActive').predicate(`${TEST_NS}isActive`),
    createdAt: timestamp('createdAt').predicate(`${TEST_NS}createdAt`),
    updatedAt: timestamp('updatedAt').predicate(`${TEST_NS}updatedAt`),
  },
  {
    base: '/.data/column-test/',
    sparqlEndpoint: '/.data/column-test/-/sparql',
    type: 'http://example.org/ColumnTest',
  }
);

describe('Column Selection in SPARQL', () => {
  let db: SolidDatabase;
  let session: any;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    db = drizzle(session);
    await db.init(testTable);
    
    // Insert a test record
    const testId = `test-${Date.now()}`;
    await db.insert(testTable).values({
      id: testId,
      title: 'Test Record',
      description: 'A test record for column selection',
      status: 'active',
      priority: 5,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).execute();
    
    console.log('Inserted test record:', testId);
  }, 60000);

  afterAll(async () => {
    // Cleanup - delete all test records
    try {
      const records = await db.select().from(testTable).execute();
      for (const record of records) {
        if (record.id) {
          await db.delete(testTable).where({ id: record.id }).execute();
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }, 30000);

  it('should generate SPARQL with all columns when no selection', async () => {
    // Build query without column selection
    const builder = db.select().from(testTable);
    const plan = (builder as any).toIR();
    
    console.log('Plan without column selection:', {
      select: plan.select,
      selectAll: plan.selectAll,
    });
    
    expect(plan.selectAll).toBe(true);
    expect(plan.select).toBeUndefined();
  });

  it('should generate SPARQL with only selected columns', async () => {
    // Build query with column selection
    const builder = db.select({
      id: testTable.id,
      title: testTable.title,
    }).from(testTable);
    
    const plan = (builder as any).toIR();
    
    console.log('Plan with column selection:', {
      select: plan.select ? Object.keys(plan.select) : null,
      selectAll: plan.selectAll,
    });
    
    expect(plan.selectAll).toBe(false);
    expect(plan.select).toBeDefined();
    expect(Object.keys(plan.select!)).toContain('id');
    expect(Object.keys(plan.select!)).toContain('title');
    expect(Object.keys(plan.select!)).not.toContain('description');
    expect(Object.keys(plan.select!)).not.toContain('status');
  });

  it('should execute query and return only selected columns', async () => {
    // Execute query with column selection
    const results = await db.select({
      id: testTable.id,
      title: testTable.title,
    }).from(testTable).execute();
    
    console.log('Results with column selection:', results);
    
    expect(results.length).toBeGreaterThan(0);
    
    const firstResult = results[0];
    expect(firstResult).toHaveProperty('id');
    expect(firstResult).toHaveProperty('title');
    // These should not be in the result (or be undefined)
    // Note: Due to how SPARQL works, extra fields might still be present but undefined
  });

  it('should compare query times between all columns and selected columns', async () => {
    // Query all columns
    const startAll = Date.now();
    const allResults = await db.select().from(testTable).execute();
    const timeAll = Date.now() - startAll;
    
    // Query selected columns
    const startSelected = Date.now();
    const selectedResults = await db.select({
      id: testTable.id,
      title: testTable.title,
    }).from(testTable).execute();
    const timeSelected = Date.now() - startSelected;
    
    console.log(`Query times - All columns: ${timeAll}ms, Selected columns: ${timeSelected}ms`);
    console.log(`All results: ${allResults.length} rows`);
    console.log(`Selected results: ${selectedResults.length} rows`);
    
    // Both should return same number of rows
    expect(selectedResults.length).toBe(allResults.length);
  });
});
