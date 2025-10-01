/**
 * Driver 单元测试
 */

import { drizzle } from '@src/driver';
import { podTable, string, int } from '@src/index';

// Mock Session for testing
const mockSession = {
  info: {
    isLoggedIn: true,
    webId: 'http://localhost:3000/alice/profile/card#me'
  },
  fetch: jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    text: jest.fn().mockResolvedValue(''),
    json: jest.fn().mockResolvedValue({}),
    clone: jest.fn().mockReturnThis()
  }),
  login: jest.fn(),
  logout: jest.fn()
} as any;

describe('Driver Tests', () => {
  test('should create drizzle instance with session', () => {
    const db = drizzle(mockSession);
    expect(db).toBeDefined();
  });

  test('should work with table definitions', () => {
    const testTable = podTable('test', {
      id: string('id').primaryKey(),
      name: string('name').notNull(),
      count: int('count')
    }, {
      containerPath: '/test/',
      rdfClass: 'https://schema.org/Thing'
    });

    const db = drizzle(mockSession);
    expect(db).toBeDefined();
    expect(testTable).toBeDefined();
  });
});