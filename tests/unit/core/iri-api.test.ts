import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PodDatabase } from '@src/core/pod-database';
import { PodDialect } from '@src/core/pod-dialect';
import { PodAsyncSession } from '@src/core/pod-session';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';
import { UpdateQueryBuilder } from '@src/core/query-builders/update-query-builder';
import { DeleteQueryBuilder } from '@src/core/query-builders/delete-query-builder';
import { eq } from '@src/core/query-conditions';
import { podTable, string, id } from '@src/core/schema';
import { UriResolverImpl } from '@src/core/uri/resolver';

const exactSparqlRows = vi.fn();

const testTable = podTable('profiles', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: '/data/profiles.ttl',
  type: 'https://schema.org/Person',
});

describe('IRI API', () => {
  describe('identifier rejection in where()', () => {
    it('should throw error when using @id in SelectQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new SelectQueryBuilder(mockSession);
      builder.from(testTable);
      
      expect(() => {
        builder.where({ '@id': 'https://example.com/profile#me' });
      }).toThrow("Using 'id' or '@id' in where() is not supported");
    });

    it('should throw error when using @id in UpdateQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new UpdateQueryBuilder(mockSession, testTable);
      builder.set({ name: 'Test' });
      
      expect(() => {
        builder.where({ '@id': 'https://example.com/profile#me' });
      }).toThrow("Using 'id' or '@id' in where() is not supported");
    });

    it('should throw error when using @id in DeleteQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new DeleteQueryBuilder(mockSession, testTable);
      
      expect(() => {
        builder.where({ '@id': 'https://example.com/profile#me' });
      }).toThrow("Using 'id' or '@id' in where() is not supported");
    });

    it('should throw error when using id object in where()', () => {
      const mockSession = {} as any;
      const builder = new SelectQueryBuilder(mockSession);
      builder.from(testTable);
      
      expect(() => {
        builder.where({ id: 'test-id' });
      }).toThrow("Using 'id' or '@id' in where() is not supported");
    });

    it('should throw error when using eq(table.id, value) in SelectQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new SelectQueryBuilder(mockSession);
      builder.from(testTable);

      expect(() => {
        builder.where(eq(testTable.id, 'test-id'));
      }).toThrow("Using 'id' or '@id' in where() is not supported");
    });

    it('should throw error when using eq(table.id, value) in UpdateQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new UpdateQueryBuilder(mockSession, testTable);
      builder.set({ name: 'Updated' });

      expect(() => {
        builder.where(eq(testTable.id, 'test-id'));
      }).toThrow("Using 'id' or '@id' in where() is not supported");
    });

    it('should throw error when using eq(table.id, value) in DeleteQueryBuilder.where()', () => {
      const mockSession = {} as any;
      const builder = new DeleteQueryBuilder(mockSession, testTable);

      expect(() => {
        builder.where(eq(testTable.id, 'test-id'));
      }).toThrow("Using 'id' or '@id' in where() is not supported");
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
    let mockSession: any;

    beforeEach(() => {
      exactSparqlRows.mockReset();

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

      mockSession = {
        select: vi.fn(() => createBuilder()),
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

      db = new PodDatabase({
        getResolver: () => ({
          resolveSubject: (_table: any, record: Record<string, unknown>) => `https://example.com/profiles.ttl#${String(record.id)}`,
        }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);
    });

    it('findByIri should require valid IRI string', async () => {
      // Empty input should throw
      await expect(async () => {
        await db.findByIri(testTable, '');
      }).rejects.toThrow('findByIri requires a valid IRI string');
    });

    it('findByLocator should require locator object', async () => {
      await expect(async () => {
        await db.findByLocator(testTable, 'not-a-locator' as any);
      }).rejects.toThrow('findByLocator requires a locator object');
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

    it('findByLocator should reject full IRI in locator.id', async () => {
      await expect(async () => {
        await db.findByLocator(testTable, { id: 'https://example.com/profile#me' });
      }).rejects.toThrow('findByLocator does not accept a full IRI in locator.id');
    });

    it('findByIri should prefer exact subject reads before whereByIri fallback', async () => {
      const dialect = {
        resolveTableResource: () => ({ mode: 'sparql', endpoint: 'https://example.com/sparql' }),
        executeOnResource: exactSparqlRows.mockResolvedValueOnce([
          { p: 'https://schema.org/name', o: 'Alice' },
        ]),
        getResolver: () => ({
          parseId: (_table: any, subjectUri: string) => subjectUri.split('#').pop(),
        }),
      } as any;

      const exactDb = new PodDatabase(dialect as PodDialect, mockSession as PodAsyncSession);
      const row = await exactDb.findByIri(testTable, 'https://example.com/profile#me');

      expect(row?.name).toBe('Alice');
      expect(exactSparqlRows).toHaveBeenCalled();
      expect(mockSession.select).not.toHaveBeenCalled();
    });

    it('findByIri should keep SPARQL-backed exact reads subject-bound and let the endpoint scope the source set', async () => {
      const dialect = {
        resolveTableResource: () => ({ mode: 'sparql', endpoint: 'https://example.com/sparql' }),
        executeOnResource: exactSparqlRows.mockResolvedValueOnce([
          { p: 'https://schema.org/name', o: 'Scoped Alice' },
        ]),
        getResolver: () => ({
          parseId: (_table: any, subjectUri: string) => subjectUri.split('#').pop(),
        }),
      } as any;

      const exactDb = new PodDatabase(dialect as PodDialect, mockSession as PodAsyncSession);
      const row = await exactDb.findByIri(testTable, 'https://example.com/profile#me');

      expect(row?.name).toBe('Scoped Alice');
      expect(exactSparqlRows).toHaveBeenCalledTimes(1);
      expect(String(exactSparqlRows.mock.calls[0]?.[1]?.query)).toBe('SELECT ?p ?o WHERE { <https://example.com/profile#me> ?p ?o . }');
      expect(mockSession.select).not.toHaveBeenCalled();
    });

    it('findByIri should return null when the exact document graph read misses', async () => {
      const dialect = {
        resolveTableResource: () => ({ mode: 'sparql', endpoint: 'https://example.com/sparql' }),
        executeOnResource: exactSparqlRows.mockResolvedValueOnce([]),
        getResolver: () => ({
          parseId: (_table: any, subjectUri: string) => subjectUri.split('#').pop(),
        }),
      } as any;

      const exactDb = new PodDatabase(dialect as PodDialect, mockSession as PodAsyncSession);
      const row = await exactDb.findByIri(testTable, 'https://example.com/profile#me');

      expect(row).toBeNull();
      expect(exactSparqlRows).toHaveBeenCalledTimes(1);
      expect(mockSession.select).not.toHaveBeenCalled();
    });

    it('findByIri should surface exact read execution errors instead of silently falling back', async () => {
      const dialect = {
        resolveTableResource: () => ({ mode: 'sparql', endpoint: 'https://example.com/sparql' }),
        executeOnResource: exactSparqlRows.mockRejectedValue(new Error('endpoint failed')),
        getResolver: () => ({
          parseId: (_table: any, subjectUri: string) => subjectUri.split('#').pop(),
        }),
      } as any;

      const exactDb = new PodDatabase(dialect as PodDialect, mockSession as PodAsyncSession);

      await expect(
        exactDb.findByIri(testTable, 'https://example.com/profile#me'),
      ).rejects.toThrow('endpoint failed');
      expect(mockSession.select).not.toHaveBeenCalled();
    });
  });

  describe('subject metadata derivation', () => {
    it('should derive id from @id when row.subject is absent', async () => {
      const messageTable = podTable('messages', {
        id: string('id').primaryKey(),
        chatId: string('chatId').predicate('http://schema.org/chatId'),
        content: string('content').predicate('http://schema.org/text'),
      }, {
        base: 'https://example.com/messages/',
        type: 'http://example.org/Message',
        subjectTemplate: '{chatId}/messages.ttl#{id}',
      });

      const session = {
        execute: vi.fn().mockResolvedValue([
          {
            '@id': 'https://example.com/messages/chat-1/messages.ttl#msg-123',
            content: 'hello',
          },
        ]),
        executeSql: vi.fn(),
        getDialect: () => ({
          getUriResolver: () => new UriResolverImpl('https://example.com/'),
        }),
      } as any;

      const rows = await new SelectQueryBuilder(session)
        .from(messageTable)
        .whereByIri('https://example.com/messages/chat-1/messages.ttl#msg-123');

      expect(rows[0]?.id).toBe('msg-123');
      expect(rows[0]?.['@id']).toBe('https://example.com/messages/chat-1/messages.ttl#msg-123');
    });
  });
});
