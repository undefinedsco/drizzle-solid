import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PodDatabase } from '@src/core/pod-database';
import { PodDialect } from '@src/core/pod-dialect';
import { PodAsyncSession } from '@src/core/pod-session';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';
import { UpdateQueryBuilder } from '@src/core/query-builders/update-query-builder';
import { DeleteQueryBuilder } from '@src/core/query-builders/delete-query-builder';
import { podTable, string, id } from '@src/core/pod-table';

const testTable = podTable('profiles', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: '/data/profiles.ttl',
  type: 'https://schema.org/Person',
});

describe('IRI API', () => {
  describe('@id rejection in where()', () => {
    it('should throw error when using @id in SelectQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new SelectQueryBuilder(mockSession);
      builder.from(testTable);
      
      expect(() => {
        builder.where({ '@id': 'https://example.com/profile#me' });
      }).toThrow("Using '@id' in where() is not supported");
    });

    it('should throw error when using @id in UpdateQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new UpdateQueryBuilder(mockSession, testTable);
      builder.set({ name: 'Test' });
      
      expect(() => {
        builder.where({ '@id': 'https://example.com/profile#me' });
      }).toThrow("Using '@id' in where() is not supported");
    });

    it('should throw error when using @id in DeleteQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new DeleteQueryBuilder(mockSession, testTable);
      
      expect(() => {
        builder.where({ '@id': 'https://example.com/profile#me' });
      }).toThrow("Using '@id' in where() is not supported");
    });

    it('should allow id (without @) in where()', () => {
      const mockSession = {} as any;
      const builder = new SelectQueryBuilder(mockSession);
      builder.from(testTable);
      
      // This should not throw
      expect(() => {
        builder.where({ id: 'test-id' });
      }).not.toThrow();
    });

    it('whereByIri should work for internal use', () => {
      const mockSession = {} as any;
      const builder = new SelectQueryBuilder(mockSession);
      builder.from(testTable);
      
      // This internal method should work
      expect(() => {
        builder.whereByIri('https://example.com/profile#me');
      }).not.toThrow();
    });
  });

  describe('*ByIri methods signature', () => {
    let db: PodDatabase;

    beforeEach(() => {
      const createBuilder = (): any => {
        const builder: any = {
          from: () => builder,
          where: vi.fn().mockImplementation(() => builder),
          whereByIri: vi.fn().mockImplementation(() => builder),
          limit: () => builder,
          then: (resolve: any) => resolve([{ id: 'test', name: 'Test' }]),
        };
        return builder;
      };

      const mockSession = {
        select: () => createBuilder(),
        update: () => ({
          set: () => ({
            where: vi.fn(),
            whereByIri: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([]),
            }),
          }),
        }),
        delete: () => ({
          where: vi.fn(),
          whereByIri: vi.fn().mockReturnValue({
            then: (resolve: any) => resolve([]),
          }),
        }),
      } as any;

      db = new PodDatabase({} as PodDialect, mockSession as PodAsyncSession);
    });

    it('findByIri should require valid IRI string', async () => {
      // Empty input should throw
      await expect(async () => {
        await db.findByIri(testTable, '');
      }).rejects.toThrow('findByIri requires a valid IRI string');
    });

    it('updateByIri should require absolute IRI', async () => {
      await expect(async () => {
        await db.updateByIri(testTable, 'relative-id', { name: 'New' });
      }).rejects.toThrow('updateByIri requires an absolute IRI');

      await expect(async () => {
        await db.updateByIri(testTable, '', { name: 'New' });
      }).rejects.toThrow('updateByIri requires a valid IRI string');
    });

    it('deleteByIri should require absolute IRI', async () => {
      await expect(async () => {
        await db.deleteByIri(testTable, 'relative-id');
      }).rejects.toThrow('deleteByIri requires an absolute IRI');

      await expect(async () => {
        await db.deleteByIri(testTable, '');
      }).rejects.toThrow('deleteByIri requires a valid IRI string');
    });

    it('subscribeByIri should require absolute IRI', async () => {
      await expect(async () => {
        await db.subscribeByIri(testTable, 'relative-id', {
          onUpdate: () => {},
        });
      }).rejects.toThrow('subscribeByIri requires an absolute IRI');
    });
  });
});
