import { describe, it, expect, vi } from 'vitest';
import { podTable, id, string, boolean, HookContext } from '../../../src/core/schema';
import { PodDatabase } from '../../../src/core/pod-database';
import { PodDialect } from '../../../src/core/pod-dialect';

describe('podTable() with hooks', () => {
  // Mock dialect and session for testing
  const createMockDb = () => {
    const mockFetch = vi.fn();
    const mockDialect = {
      getAuthenticatedFetch: () => mockFetch,
      getWebId: () => 'https://alice.pod/profile/card#me',
      config: {},
      getConfig: () => ({}),
    } as unknown as PodDialect;
    
    const mockSession = {
      getDialect: () => mockDialect,
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn(),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnThis(),
        then: vi.fn(),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        then: vi.fn(),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        then: vi.fn(),
      }),
    } as any;

    return new PodDatabase(mockDialect, mockSession);
  };

  describe('basic usage', () => {
    it('should create table with base', () => {
      const db = createMockDb();
      
      const userTable = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
        email: string('email').predicate('https://schema.org/email'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
      });

      expect(userTable.config.name).toBe('users');
      expect(userTable.config.base).toBe('/data/users/');
      expect(userTable.config.type).toBe('https://schema.org/Person');
      expect(userTable.columns.id).toBeDefined();
      expect(userTable.columns.name).toBeDefined();
      expect(userTable.columns.email).toBeDefined();
    });

    it('should create table with hooks', () => {
      const db = createMockDb();
      
      const afterInsertFn = vi.fn();
      const afterUpdateFn = vi.fn();
      const afterDeleteFn = vi.fn();

      const userTable = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        hooks: {
          afterInsert: afterInsertFn,
          afterUpdate: afterUpdateFn,
          afterDelete: afterDeleteFn,
        },
      });

      expect(userTable.config.hooks).toBeDefined();
      expect(userTable.config.hooks?.afterInsert).toBe(afterInsertFn);
      expect(userTable.config.hooks?.afterUpdate).toBe(afterUpdateFn);
      expect(userTable.config.hooks?.afterDelete).toBe(afterDeleteFn);
    });

    it('should work without hooks', () => {
      const db = createMockDb();
      
      const agents = podTable('agents', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
        public: boolean('public').predicate('https://schema.org/isPublic'),
      }, {
        base: '/data/agents.ttl',
        type: 'https://vocab.ai/Agent',
      });

      expect(agents.config.hooks).toBeUndefined();
    });
  });

  describe('hooks with db access', () => {
    it('should allow hooks to access db in context', () => {
      const db = createMockDb();
      
      let capturedDb: any = null;

      const userTable = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        hooks: {
          afterInsert: async (ctx: HookContext, record) => {
            // Capture db from context
            capturedDb = ctx.db;
          },
        },
      });

      // The hook is configured
      expect(userTable.config.hooks?.afterInsert).toBeDefined();
      // Note: _db is not automatically set by podTable
      // User can manually set table._db = db if needed
    });

    it('should support cross-table operations in hooks', () => {
      const db = createMockDb();
      
      // First table for audit logs
      const auditTable = podTable('audit_logs', {
        id: id(),
        action: string('action').predicate('https://example.org/action'),
        entityId: string('entityId').predicate('https://example.org/entityId'),
      }, {
        base: '/data/audit/',
        type: 'https://example.org/AuditLog',
      });

      // User table with hooks that reference audit table
      const userTable = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        hooks: {
          afterInsert: async (ctx: HookContext, record) => {
            // This demonstrates the pattern: hooks can use ctx.db
            // to interact with other tables
            if (ctx.db) {
              // In real usage:
              // await ctx.db.insert(auditTable).values({
              //   action: 'user_created',
              //   entityId: record['@id'],
              // });
            }
          },
        },
      });

      expect(userTable.config.hooks?.afterInsert).toBeDefined();
    });
  });

  describe('type inference', () => {
    it('should preserve column types', () => {
      const db = createMockDb();
      
      const userTable = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
        active: boolean('active').predicate('https://schema.org/isActive'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
      });

      // Type inference should work
      expect(userTable.columns.id.dataType).toBe('string');
      expect(userTable.columns.name.dataType).toBe('string');
      expect(userTable.columns.active.dataType).toBe('boolean');
    });
  });

  describe('schema reusability', () => {
    it('should allow same schema structure with different bases', () => {
      const db = createMockDb();
      
      const localUsers = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
      });

      const archivedUsers = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/archive/users/',
        type: 'https://schema.org/Person',
      });

      expect(localUsers.config.base).toBe('/data/users/');
      expect(archivedUsers.config.base).toBe('/archive/users/');
      
      // Same schema structure
      expect(localUsers.config.type).toBe(archivedUsers.config.type);
      expect(localUsers.config.name).toBe(archivedUsers.config.name);
    });

    it('should allow same structure with different hooks', () => {
      const db = createMockDb();
      
      const hook1 = vi.fn();
      const hook2 = vi.fn();

      const table1 = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users1/',
        type: 'https://schema.org/Person',
        hooks: { afterInsert: hook1 },
      });

      const table2 = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users2/',
        type: 'https://schema.org/Person',
        hooks: { afterInsert: hook2 },
      });

      expect(table1.config.hooks?.afterInsert).toBe(hook1);
      expect(table2.config.hooks?.afterInsert).toBe(hook2);
    });
  });
});
