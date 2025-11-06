/**
 * Driver 单元测试
 */

import { drizzle } from '@src/driver';
import { podTable, string, int } from '@src/index';

import { vi } from 'vitest';

// Mock Session for testing
const mockSession = {
  info: {
    isLoggedIn: true,
    webId: 'http://localhost:3000/alice/profile/card#me'
  },
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(''),
    json: vi.fn().mockResolvedValue({}),
    clone: vi.fn().mockReturnThis()
  }),
  login: vi.fn(),
  logout: vi.fn()
} as any;

describe('Driver Tests', () => {
  test('should create drizzle instance with session', () => {
    const db = drizzle(mockSession);
    expect(db).toBeDefined();
  });

  test('should work with table definitions', () => {
    const testTable = podTable('test', {
      id: string('id').primaryKey().predicate('https://schema.org/identifier'),
      name: string('name').notNull().predicate('https://schema.org/name'),
      count: int('count').predicate('https://schema.org/quantitativeValue')
    }, {
      resourcePath: 'idp:///test/index.ttl',
      rdfClass: 'https://schema.org/Thing',
      namespace: { prefix: 'schema', uri: 'https://schema.org/' }
    });

    const db = drizzle(mockSession);
    expect(db).toBeDefined();
    expect(testTable).toBeDefined();
  });
});
