import { describe, it, expect, vi } from 'vitest';
import { PodAsyncSession } from '@src/core/pod-session';
import { podTable, id, string } from '@src/core/schema';
import { InsertQueryBuilder } from '@src/core/query-builders/insert-query-builder';

describe('ID Generation', () => {
  const mockDialect = {
    query: vi.fn().mockResolvedValue([]),
  } as any;

  const session = new PodAsyncSession(mockDialect);

  const users = podTable('users', {
    id: id(),
    name: string('name').predicate('http://schema.org/name')
  }, {
    base: '/data/users.ttl',
    type: 'http://schema.org/Person'
  });

  it('should automatically generate ID if not provided', async () => {
    const insertBuilder = new InsertQueryBuilder(session, users);
    insertBuilder.values({ name: 'Alice' });
    
    // We access private method or property for testing, or check the generated plan
    // InsertQueryBuilder has toIR()
    const plan = insertBuilder.toIR();
    
    expect(plan.rows.length).toBe(1);
    const row = plan.rows[0];
    
    expect(row.name).toBe('Alice');
    expect(row.id).toBeDefined();
    expect(typeof row.id).toBe('string');
    expect((row.id as string).length).toBeGreaterThan(10); // Check for NanoID length
  });

  it('should respect provided ID', async () => {
    const insertBuilder = new InsertQueryBuilder(session, users);
    insertBuilder.values({ id: 'manual-id', name: 'Bob' });
    
    const plan = insertBuilder.toIR();
    const row = plan.rows[0];
    
    expect(row.id).toBe('manual-id');
  });

  it('should use custom generator if configured', async () => {
    const customTable = podTable('custom', {
      id: id('id', { defaultValue: () => 'custom-id-123' }),
      name: string('name').predicate('http://schema.org/name')
    }, { base: '/data/custom.ttl', type: 'http://example.org/Test' });

    const insertBuilder = new InsertQueryBuilder(session, customTable);
    insertBuilder.values({ name: 'Charlie' });
    
    const plan = insertBuilder.toIR();
    expect(plan.rows[0].id).toBe('custom-id-123');
  });
});
