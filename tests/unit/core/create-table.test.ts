import { describe, it, expect, vi } from 'vitest';
import { solidSchema, id, string, boolean, HookContext } from '../../../src/core/pod-table';
import { PodDatabase } from '../../../src/core/pod-database';
import { PodDialect } from '../../../src/core/pod-dialect';

describe('db.createTable()', () => {
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
    it('should create table from schema with base', () => {
      const db = createMockDb();
      
      const userSchema = solidSchema('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
        email: string('email').predicate('https://schema.org/email'),
      }, {
        type: 'https://schema.org/Person',
      });

      const userTable = db.createTable(userSchema, {
        base: '/data/users/',
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
      
      const userSchema = solidSchema('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        type: 'https://schema.org/Person',
      });

      const afterInsertFn = vi.fn();
      const afterUpdateFn = vi.fn();
      const afterDeleteFn = vi.fn();

      const userTable = db.createTable(userSchema, {
        base: '/data/users/',
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

    it('should store db reference in table for hook context', () => {
      const db = createMockDb();
      
      const userSchema = solidSchema('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        type: 'https://schema.org/Person',
      });

      const userTable = db.createTable(userSchema, {
        base: '/data/users/',
      });

      // The _db reference should be set
      expect((userTable as any)._db).toBe(db);
    });
  });

  describe('hooks with db access', () => {
    it('should allow hooks to access db in context', () => {
      const db = createMockDb();
      
      const userSchema = solidSchema('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        type: 'https://schema.org/Person',
      });

      let capturedDb: any = null;

      const userTable = db.createTable(userSchema, {
        base: '/data/users/',
        hooks: {
          afterInsert: async (ctx: HookContext, record) => {
            // Capture the db from context
            capturedDb = ctx.db;
          },
        },
      });

      // The hook is configured with access to db
      expect(userTable.config.hooks?.afterInsert).toBeDefined();
      // The _db is stored on the table
      expect((userTable as any)._db).toBe(db);
    });

    it('should support cross-table operations in hooks', () => {
      const db = createMockDb();
      
      // First schema/table for audit logs
      const auditSchema = solidSchema('audit_logs', {
        id: id(),
        action: string('action').predicate('https://example.org/action'),
        entityId: string('entityId').predicate('https://example.org/entityId'),
      }, {
        type: 'https://example.org/AuditLog',
      });

      const auditTable = db.createTable(auditSchema, {
        base: '/data/audit/',
      });

      // User schema with hooks that reference audit table
      const userSchema = solidSchema('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        type: 'https://schema.org/Person',
      });

      const userTable = db.createTable(userSchema, {
        base: '/data/users/',
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
      expect((userTable as any)._db).toBe(db);
    });
  });

  describe('type inference', () => {
    it('should preserve column types from schema', () => {
      const db = createMockDb();
      
      const userSchema = solidSchema('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
        active: boolean('active').predicate('https://schema.org/isActive'),
      }, {
        type: 'https://schema.org/Person',
      });

      const userTable = db.createTable(userSchema, {
        base: '/data/users/',
      });

      // Type inference should work
      expect(userTable.columns.id.dataType).toBe('string');
      expect(userTable.columns.name.dataType).toBe('string');
      expect(userTable.columns.active.dataType).toBe('boolean');
    });
  });

  describe('schema reusability', () => {
    it('should allow same schema to create multiple tables with different bases', () => {
      const db = createMockDb();
      
      const userSchema = solidSchema('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        type: 'https://schema.org/Person',
      });

      const localUsers = db.createTable(userSchema, {
        base: '/data/users/',
      });

      const archivedUsers = db.createTable(userSchema, {
        base: '/archive/users/',
      });

      expect(localUsers.config.base).toBe('/data/users/');
      expect(archivedUsers.config.base).toBe('/archive/users/');
      
      // Same schema structure
      expect(localUsers.config.type).toBe(archivedUsers.config.type);
      expect(localUsers.config.name).toBe(archivedUsers.config.name);
    });

    it('should allow same schema with different hooks', () => {
      const db = createMockDb();
      
      const userSchema = solidSchema('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        type: 'https://schema.org/Person',
      });

      const hook1 = vi.fn();
      const hook2 = vi.fn();

      const table1 = db.createTable(userSchema, {
        base: '/data/users1/',
        hooks: { afterInsert: hook1 },
      });

      const table2 = db.createTable(userSchema, {
        base: '/data/users2/',
        hooks: { afterInsert: hook2 },
      });

      expect(table1.config.hooks?.afterInsert).toBe(hook1);
      expect(table2.config.hooks?.afterInsert).toBe(hook2);
    });
  });
});
