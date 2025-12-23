import { describe, it, expect } from 'vitest';
import { podTable, id, string, boolean, HookContext, TableHooks } from '../../../src/core/pod-table';

describe('TableHooks', () => {
  describe('hooks configuration', () => {
    it('should store hooks in table config', () => {
      const afterInsertFn = async (ctx: HookContext, record: Record<string, unknown>) => {
        // Hook logic
      };

      const agents = podTable('agents', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
        public: boolean('public').predicate('https://schema.org/isPublic'),
      }, {
        base: '/data/agents.ttl',
        type: 'https://vocab.ai/Agent',
        hooks: {
          afterInsert: afterInsertFn,
        },
      });

      expect(agents.config.hooks).toBeDefined();
      expect(agents.config.hooks?.afterInsert).toBe(afterInsertFn);
    });

    it('should support all hook types', () => {
      const afterInsertFn = async (ctx: HookContext, record: Record<string, unknown>) => {};
      const afterUpdateFn = async (ctx: HookContext, record: Record<string, unknown>, changes: Record<string, unknown>) => {};
      const afterDeleteFn = async (ctx: HookContext, record: Record<string, unknown>) => {};

      const agents = podTable('agents', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/agents.ttl',
        type: 'https://vocab.ai/Agent',
        hooks: {
          afterInsert: afterInsertFn,
          afterUpdate: afterUpdateFn,
          afterDelete: afterDeleteFn,
        },
      });

      expect(agents.config.hooks?.afterInsert).toBe(afterInsertFn);
      expect(agents.config.hooks?.afterUpdate).toBe(afterUpdateFn);
      expect(agents.config.hooks?.afterDelete).toBe(afterDeleteFn);
    });

    it('should work without hooks', () => {
      const agents = podTable('agents', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/agents.ttl',
        type: 'https://vocab.ai/Agent',
      });

      expect(agents.config.hooks).toBeUndefined();
    });

    it('should support partial hooks configuration', () => {
      const afterInsertFn = async (ctx: HookContext, record: Record<string, unknown>) => {};

      const agents = podTable('agents', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/agents.ttl',
        type: 'https://vocab.ai/Agent',
        hooks: {
          afterInsert: afterInsertFn,
          // No afterUpdate or afterDelete
        },
      });

      expect(agents.config.hooks?.afterInsert).toBe(afterInsertFn);
      expect(agents.config.hooks?.afterUpdate).toBeUndefined();
      expect(agents.config.hooks?.afterDelete).toBeUndefined();
    });
  });

  describe('hook context types', () => {
    it('should have correct HookContext shape', () => {
      // This is a type test - if it compiles, it passes
      const ctx: HookContext = {
        session: {
          info: {
            isLoggedIn: true,
            webId: 'https://alice.pod/profile/card#me',
          },
          fetch: globalThis.fetch,
        },
        table: {} as any,
      };

      expect(ctx.session).toBeDefined();
      expect(ctx.session.info.webId).toBe('https://alice.pod/profile/card#me');
      expect(ctx.session.fetch).toBeDefined();
      expect(ctx.table).toBeDefined();
    });

    it('should have correct TableHooks shape', () => {
      // This is a type test - if it compiles, it passes
      const hooks: TableHooks = {
        afterInsert: async (ctx, record) => {
          const id = record['@id'];
          const name = record.name;
        },
        afterUpdate: async (ctx, record, changes) => {
          const changedFields = Object.keys(changes);
        },
        afterDelete: async (ctx, record) => {
          const deletedId = record['@id'];
        },
      };

      expect(hooks.afterInsert).toBeDefined();
      expect(hooks.afterUpdate).toBeDefined();
      expect(hooks.afterDelete).toBeDefined();
    });
  });

  describe('publish pattern with hooks', () => {
    it('should support publish pattern using hooks', () => {
      // This demonstrates how users can implement publish logic using hooks
      const FOAF_MADE = 'http://xmlns.com/foaf/0.1/made';

      const agents = podTable('agents', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
        public: boolean('public').predicate('https://schema.org/isPublic'),
      }, {
        base: '/data/agents.ttl',
        type: 'https://vocab.ai/Agent',
        hooks: {
          afterInsert: async (ctx, record) => {
            // User implements publish logic here
            if (record.public) {
              // const pm = new ProfileManager(ctx.session);
              // await pm.addToProfile(FOAF_MADE, record['@id'] as string);
            }
          },
          afterUpdate: async (ctx, record, changes) => {
            // User implements publish logic here
            if ('public' in changes) {
              // const pm = new ProfileManager(ctx.session);
              // if (record.public) {
              //   await pm.addToProfile(FOAF_MADE, record['@id'] as string);
              // } else {
              //   await pm.removeFromProfile(FOAF_MADE, record['@id'] as string);
              // }
            }
          },
        },
      });

      // Verify the hooks are configured
      expect(agents.config.hooks?.afterInsert).toBeDefined();
      expect(agents.config.hooks?.afterUpdate).toBeDefined();
    });
  });
});
