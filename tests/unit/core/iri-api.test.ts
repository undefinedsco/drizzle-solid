import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PodDatabase } from '@src/core/pod-database';
import { PodDialect } from '@src/core/pod-dialect';
import { PodAsyncSession } from '@src/core/pod-session';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';
import { UpdateQueryBuilder } from '@src/core/query-builders/update-query-builder';
import { DeleteQueryBuilder } from '@src/core/query-builders/delete-query-builder';
import { eq } from '@src/core/query-conditions';
import { object, podTable, string, id, uri } from '@src/core/schema';
import { UriResolverImpl } from '@src/core/uri/resolver';
import { extractPodResourceTemplateValue, parsePodResourceRef } from '@src/core/resource-reference';

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
          then: (resolve: any) => resolve([{ id: 'test', '@id': 'https://example.com/profiles.ttl#test', name: 'Test' }]),
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

    it('findByIri should fall back to precise query when the exact resource document is missing', async () => {
      const builder: any = {
        from: vi.fn(() => builder),
        whereByIri: vi.fn(() => builder),
        limit: vi.fn(() => Promise.resolve([{ id: 'profile-1', name: 'Fallback' }])),
      };
      const select = vi.fn(() => builder);
      const exactDb = new PodDatabase({
        getResolver: () => ({
          resolveSubject: (_table: any, record: Record<string, unknown>) => `https://example.com/profiles.ttl#${String(record.id)}`,
          parseId: (_table: any, iri: string) => iri.split('#').pop() ?? iri,
        }),
        executeOnResource: vi.fn().mockRejectedValue(new Error('Could not retrieve https://example.com/missing.ttl (HTTP status 404)')),
      } as unknown as PodDialect, { select } as unknown as PodAsyncSession);

      await expect(exactDb.findByIri(testTable, 'https://example.com/missing.ttl#profile-1')).resolves.toMatchObject({
        id: 'profile-1',
      });
      expect(builder.whereByIri).toHaveBeenCalledWith('https://example.com/missing.ttl#profile-1');
    });

    it('findByIri should prefer exact resource reads for resources with SPARQL endpoints', async () => {
      const indexedResource = podTable('indexedProfiles', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/profiles/',
        sparqlEndpoint: '/data/profiles/-/sparql',
        type: 'https://schema.org/Person',
        subjectTemplate: '{id}.ttl',
      });
      const builder: any = {
        from: vi.fn(() => builder),
        whereByIri: vi.fn(() => builder),
        limit: vi.fn(() => Promise.resolve([{ id: 'profile-1', name: 'Indexed' }])),
      };
      const select = vi.fn(() => builder);
      const executeOnResource = vi.fn().mockResolvedValueOnce([
        { p: 'https://schema.org/name', o: 'Indexed exact' },
      ]);
      const exactDb = new PodDatabase({
        getResolver: () => ({
          resolveSubject: (_table: any, record: Record<string, unknown>) => `https://example.com/data/profiles/${String(record.id)}.ttl`,
          parseId: (_table: any, iri: string) => iri.split('/').pop()?.replace(/\.ttl$/, '') ?? iri,
        }),
        executeOnResource,
      } as unknown as PodDialect, { select } as unknown as PodAsyncSession);

      await expect(exactDb.findByIri(indexedResource, 'https://example.com/data/profiles/profile-1.ttl')).resolves.toMatchObject({
        id: 'profile-1.ttl',
        name: 'Indexed exact',
      });
      expect(executeOnResource).toHaveBeenCalledWith(
        'https://example.com/data/profiles/profile-1.ttl',
        expect.objectContaining({
          query: 'SELECT ?p ?o WHERE { <https://example.com/data/profiles/profile-1.ttl> ?p ?o . }',
        }),
      );
      expect(builder.whereByIri).not.toHaveBeenCalled();
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

    it('findByLocator should accept base-relative resource ids without extra template variables', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const resolveSubject = vi.fn((_table: any, record: Record<string, unknown>) =>
        `https://example.com/.data/approvals/${String(record.id)}`,
      );
      const exactDb = new PodDatabase({
        getResolver: () => ({ resolveSubject }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      await exactDb.findByLocator(approvalTable, { id: '2026/05/07.ttl#approval_123' });

      expect(resolveSubject).toHaveBeenCalledWith(approvalTable, { id: '2026/05/07.ttl#approval_123' });
      expect(mockSession.select).toHaveBeenCalled();
    });

    it('findByLocator should reject local fragment ids when a template has storage slots', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const exactDb = new PodDatabase({
        getResolver: () => ({
          resolveSubject: vi.fn(),
        }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      await expect(async () => {
        await exactDb.findByLocator(approvalTable, { id: '#approval_123' });
      }).rejects.toThrow("findByLocator requires a complete locator for subjectTemplate '{yyyy}/{MM}/{dd}.ttl#{id}'");
    });

    it('findByLocator should reject local fragment ids for multi-slot templates even when slots are present', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const resolveSubject = vi.fn();
      const exactDb = new PodDatabase({
        getResolver: () => ({
          resolveSubject,
        }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      await expect(async () => {
        await exactDb.findByLocator(approvalTable, {
          id: '#approval_123',
          createdAt: new Date('2026-05-07T00:00:00.000Z'),
        });
      }).rejects.toThrow("findByLocator requires a complete locator for subjectTemplate '{yyyy}/{MM}/{dd}.ttl#{id}'");
      expect(resolveSubject).not.toHaveBeenCalled();
    });

    it('findById should resolve base-relative resource ids without locator slots', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const resolveSubject = vi.fn((_table: any, record: Record<string, unknown>) =>
        `https://example.com/.data/approvals/${String(record.id)}`,
      );
      const exactDb = new PodDatabase({
        getResolver: () => ({ resolveSubject }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      await exactDb.findById(approvalTable, '2026/05/07.ttl#approval_123');

      expect(resolveSubject).toHaveBeenCalledWith(approvalTable, { id: '2026/05/07.ttl#approval_123' });
      expect(mockSession.select).toHaveBeenCalled();
    });

    it('findById should resolve naked short ids by querying the resource subject index', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
        sparqlEndpoint: 'https://example.com/.data/approvals/-/sparql',
      });
      const executeOnResource = vi.fn().mockResolvedValue([
        { subject: 'https://example.com/.data/approvals/2026/05/07.ttl#approval_123' },
      ]);
      const exactDb = new PodDatabase({
        resolveTableResource: () => ({
          mode: 'sparql',
          endpoint: 'https://example.com/.data/approvals/-/sparql',
        }),
        getResolver: () => ({
          resolveSubject: vi.fn(),
        }),
        executeOnResource,
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      await exactDb.findById(approvalTable, 'approval_123');

      expect(executeOnResource).toHaveBeenCalledWith(
        'https://example.com/.data/approvals/-/sparql',
        expect.objectContaining({
          query: expect.stringContaining('CONTAINS(STR(?subject), "approval_123")'),
        }),
        expect.objectContaining({ mode: 'sparql' }),
      );

      await expect(async () => {
        await exactDb.findById(approvalTable, '#approval_123');
      }).rejects.toThrow("findById requires a base-relative resource id for subjectTemplate '{yyyy}/{MM}/{dd}.ttl#{id}'");
    });

    it('updateById and deleteById should resolve base-relative resource ids', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const resolveSubject = vi.fn((_table: any, record: Record<string, unknown>) =>
        `https://example.com/.data/approvals/${String(record.id)}`,
      );
      const exactDb = new PodDatabase({
        getResolver: () => ({ resolveSubject }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);
      const fullIri = 'https://example.com/.data/approvals/2026/05/07.ttl#approval_123';

      const updateSpy = vi.spyOn(exactDb, 'updateByIri').mockResolvedValue({ id: 'approval_123' } as never);
      await exactDb.updateById(approvalTable, '2026/05/07.ttl#approval_123', { name: 'Approved' });
      expect(updateSpy).toHaveBeenCalledWith(approvalTable, fullIri, { name: 'Approved' });
      updateSpy.mockRestore();

      const deleteSpy = vi.spyOn(exactDb, 'deleteByIri').mockResolvedValue(true);
      await exactDb.deleteById(approvalTable, '2026/05/07.ttl#approval_123');
      expect(deleteSpy).toHaveBeenCalledWith(approvalTable, fullIri);
      deleteSpy.mockRestore();
    });

    it('updateById should resolve naked short ids by querying the resource subject index', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
        sparqlEndpoint: 'https://example.com/.data/approvals/-/sparql',
      });
      const executeOnResource = vi.fn().mockResolvedValue([
        { subject: 'https://example.com/.data/approvals/2026/05/07.ttl#approval_123' },
      ]);
      const exactDb = new PodDatabase({
        resolveTableResource: () => ({
          mode: 'sparql',
          endpoint: 'https://example.com/.data/approvals/-/sparql',
        }),
        getResolver: () => ({
          resolveSubject: vi.fn(),
        }),
        executeOnResource,
      } as unknown as PodDialect, mockSession as PodAsyncSession);
      const updateSpy = vi.spyOn(exactDb, 'updateByIri').mockResolvedValue({ id: 'approval_123' } as never);

      await exactDb.updateById(approvalTable, 'approval_123', { name: 'Approved' });

      expect(updateSpy).toHaveBeenCalledWith(
        approvalTable,
        'https://example.com/.data/approvals/2026/05/07.ttl#approval_123',
        { name: 'Approved' },
      );
      updateSpy.mockRestore();
    });

    it('findByLocator should warn once about deprecation', async () => {
      (PodDatabase as any).findByLocatorDeprecationWarned = false;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const resolveSubject = vi.fn((_table: any, record: Record<string, unknown>) =>
        `https://example.com/profiles.ttl#${String(record.id)}`,
      );
      const exactDb = new PodDatabase({
        getResolver: () => ({ resolveSubject }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      await exactDb.findByLocator(testTable, { id: 'first' });
      await exactDb.findByLocator(testTable, { id: 'second' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('findByLocator(resource, locator) is deprecated');
      warnSpy.mockRestore();
      (PodDatabase as any).findByLocatorDeprecationWarned = false;
    });

    it('resolveLocatorIri and resolveLocatorId should expose ORM-owned subject and resource id resolution', () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const resolver = {
        resolveSubject: (table: any, record: Record<string, unknown>) => {
          const createdAt = record.createdAt instanceof Date
            ? record.createdAt
            : new Date(String(record.createdAt ?? '2026-05-07T00:00:00.000Z'));
          const yyyy = String(createdAt.getUTCFullYear());
          const MM = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(createdAt.getUTCDate()).padStart(2, '0');
          if (String(record.id).includes('/') || String(record.id).includes('#')) {
            return `https://example.com/.data/approvals/${String(record.id)}`;
          }
          return `https://example.com/.data/approvals/${yyyy}/${MM}/${dd}.ttl#${String(record.id)}`;
        },
        parseId: (_table: any, iri: string) => iri.split('#').pop() ?? iri,
      };
      const exactDb = new PodDatabase({
        getResolver: () => resolver,
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      expect(exactDb.resolveLocatorIri(approvalTable, {
        id: 'approval_123',
        createdAt: new Date('2026-05-07T00:00:00.000Z'),
      })).toBe('https://example.com/.data/approvals/2026/05/07.ttl#approval_123');
      expect(exactDb.resolveLocatorId(approvalTable, { id: '2026/05/07.ttl#approval_123' }))
        .toBe('2026/05/07.ttl#approval_123');
    });

    it('resolveRowIri and resolveRowId should prefer known row IRI before locator reconstruction', () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const resolver = {
        resolveSubject: vi.fn(),
        parseId: (_table: any, iri: string) => iri.split('#').pop() ?? iri,
      };
      const exactDb = new PodDatabase({
        getResolver: () => resolver,
      } as unknown as PodDialect, mockSession as PodAsyncSession);
      const row = {
        id: 'approval_123',
        '@id': 'https://example.com/.data/approvals/2026/05/07.ttl#approval_123',
      };

      expect(exactDb.resolveRowIri(approvalTable, row))
        .toBe('https://example.com/.data/approvals/2026/05/07.ttl#approval_123');
      expect(exactDb.resolveRowId(approvalTable, row))
        .toBe('2026/05/07.ttl#approval_123');
      expect(resolver.resolveSubject).not.toHaveBeenCalled();
    });

    it('resolveResourceIri and resolveResourceId should accept full IRIs, rows, locators, and base-relative ids', () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const resolver = {
        resolveSubject: (table: any, record: Record<string, unknown>) => {
          const createdAt = record.createdAt instanceof Date
            ? record.createdAt
            : new Date(String(record.createdAt ?? '2026-05-07T00:00:00.000Z'));
          const yyyy = String(createdAt.getUTCFullYear());
          const MM = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(createdAt.getUTCDate()).padStart(2, '0');
          if (String(record.id).includes('/') || String(record.id).includes('#')) {
            return `https://example.com/.data/approvals/${String(record.id)}`;
          }
          return `https://example.com/.data/approvals/${yyyy}/${MM}/${dd}.ttl#${String(record.id)}`;
        },
        parseId: (_table: any, iri: string) => iri.split('#').pop() ?? iri,
      };
      const exactDb = new PodDatabase({
        getResolver: () => resolver,
      } as unknown as PodDialect, mockSession as PodAsyncSession);
      const fullIri = 'https://example.com/.data/approvals/2026/05/07.ttl#approval_123';

      expect(exactDb.resolveResourceIri(approvalTable, fullIri)).toBe(fullIri);
      expect(exactDb.resolveResourceIri(approvalTable, { id: 'approval_123', createdAt: new Date('2026-05-07T00:00:00.000Z') })).toBe(fullIri);
      expect(exactDb.resolveResourceIri(approvalTable, '2026/05/07.ttl#approval_123')).toBe(fullIri);
      expect(exactDb.resolveResourceId(approvalTable, { '@id': fullIri })).toBe('2026/05/07.ttl#approval_123');
      expect(exactDb.resolveRelationIri(approvalTable, { id: 'approval_123', createdAt: new Date('2026-05-07T00:00:00.000Z') })).toBe(fullIri);
    });

    it('*ByResource methods should accept full IRIs, rows, locators, and base-relative ids', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });
      const resolver = {
        resolveSubject: (table: any, record: Record<string, unknown>) => {
          const createdAt = record.createdAt instanceof Date
            ? record.createdAt
            : new Date(String(record.createdAt ?? '2026-05-07T00:00:00.000Z'));
          const yyyy = String(createdAt.getUTCFullYear());
          const MM = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(createdAt.getUTCDate()).padStart(2, '0');
          if (String(record.id).includes('/') || String(record.id).includes('#')) {
            return `https://example.com/.data/approvals/${String(record.id)}`;
          }
          return `https://example.com/.data/approvals/${yyyy}/${MM}/${dd}.ttl#${String(record.id)}`;
        },
        parseId: (_table: any, iri: string) => iri.split('#').pop() ?? iri,
      };
      const exactDb = new PodDatabase({
        getResolver: () => resolver,
      } as unknown as PodDialect, mockSession as PodAsyncSession);
      const fullIri = 'https://example.com/.data/approvals/2026/05/07.ttl#approval_123';

      const findSpy = vi.spyOn(exactDb, 'findByIri').mockResolvedValue({ id: 'approval_123' } as never);
      await exactDb.findByResource(approvalTable, { id: 'approval_123', createdAt: new Date('2026-05-07T00:00:00.000Z') });
      await exactDb.findByResource(approvalTable, '2026/05/07.ttl#approval_123');
      expect(findSpy).toHaveBeenNthCalledWith(1, approvalTable, fullIri);
      expect(findSpy).toHaveBeenNthCalledWith(2, approvalTable, fullIri);
      findSpy.mockRestore();

      const updateSpy = vi.spyOn(exactDb, 'updateByIri').mockResolvedValue({ id: 'approval_123' } as never);
      await exactDb.updateByResource(approvalTable, { '@id': fullIri }, { name: 'Approved' });
      expect(updateSpy).toHaveBeenCalledWith(approvalTable, fullIri, { name: 'Approved' });
      updateSpy.mockRestore();

      const deleteSpy = vi.spyOn(exactDb, 'deleteByIri').mockResolvedValue(true);
      await exactDb.deleteByResource(approvalTable, fullIri);
      expect(deleteSpy).toHaveBeenCalledWith(approvalTable, fullIri);
      deleteSpy.mockRestore();
    });

    it('*ByResource methods should resolve naked short ids through the subject index', async () => {
      const approvalTable = podTable('approvals', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
        sparqlEndpoint: 'https://example.com/.data/approvals/-/sparql',
      });
      const executeOnResource = vi.fn().mockResolvedValue([
        { subject: 'https://example.com/.data/approvals/2026/05/07.ttl#approval_123' },
      ]);
      const exactDb = new PodDatabase({
        resolveTableResource: () => ({
          mode: 'sparql',
          endpoint: 'https://example.com/.data/approvals/-/sparql',
        }),
        getResolver: () => ({
          resolveSubject: vi.fn(),
        }),
        executeOnResource,
      } as unknown as PodDialect, mockSession as PodAsyncSession);
      const fullIri = 'https://example.com/.data/approvals/2026/05/07.ttl#approval_123';

      const findSpy = vi.spyOn(exactDb, 'findByIri').mockResolvedValue({ id: 'approval_123' } as never);
      await exactDb.findByResource(approvalTable, 'approval_123');
      expect(findSpy).toHaveBeenCalledWith(approvalTable, fullIri);
      findSpy.mockRestore();

      const updateSpy = vi.spyOn(exactDb, 'updateByIri').mockResolvedValue({ id: 'approval_123' } as never);
      await exactDb.updateByResource(approvalTable, 'approval_123', { name: 'Approved' });
      expect(updateSpy).toHaveBeenCalledWith(approvalTable, fullIri, { name: 'Approved' });
      updateSpy.mockRestore();

      const deleteSpy = vi.spyOn(exactDb, 'deleteByIri').mockResolvedValue(true);
      await exactDb.deleteByResource(approvalTable, 'approval_123');
      expect(deleteSpy).toHaveBeenCalledWith(approvalTable, fullIri);
      deleteSpy.mockRestore();
    });

    it('resolveLocatorIri should treat transformed subjectTemplate variables as their source field names', () => {
      const chatTable = podTable('chat', {
        id: id(),
        title: string('title').predicate('https://schema.org/name'),
      }, {
        base: 'https://example.com/.data/chat/',
        type: 'https://example.org/Chat',
        subjectTemplate: '{id}/index.ttl#this',
      });
      const messageTable = podTable('message', {
        id: id(),
        chat: uri('chat').predicate('https://example.org/chat').link(chatTable),
        content: string('content').predicate('https://schema.org/text'),
      }, {
        base: 'https://example.com/.data/chat/',
        type: 'https://example.org/Message',
        subjectTemplate: '{chat|id}/{yyyy}/{MM}/{dd}/messages.ttl#{id}',
      });
      const resolveSubject = vi.fn((_table: any, record: Record<string, unknown>) =>
        `https://example.com/.data/chat/chat-1/2026/05/07/messages.ttl#${String(record.id)}`,
      );
      const exactDb = new PodDatabase({
        getResolver: () => ({ resolveSubject, parseId: (_table: any, iri: string) => iri }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      expect(exactDb.resolveLocatorIri(messageTable, {
        id: 'msg-1',
        chat: 'https://example.com/.data/chat/chat-1/index.ttl#this',
        createdAt: new Date('2026-05-07T00:00:00.000Z'),
      })).toBe('https://example.com/.data/chat/chat-1/2026/05/07/messages.ttl#msg-1');
      expect(resolveSubject).toHaveBeenCalled();
    });

    it('parsePodResourceRef should parse resource ids and template values from table metadata', () => {
      const chatTable = podTable('chat', {
        id: id(),
        title: string('title').predicate('https://schema.org/name'),
      }, {
        base: '/.data/chat/',
        type: 'https://example.org/Chat',
        subjectTemplate: '{id}/index.ttl#this',
      });
      const threadTable = podTable('thread', {
        id: id(),
        chat: uri('chat').predicate('https://example.org/chat').link(chatTable),
      }, {
        base: '/.data/chat/',
        type: 'https://example.org/Thread',
        subjectTemplate: '{chat|id}/index.ttl#{id}',
      });
      const approvalTable = podTable('approval', {
        id: id(),
      }, {
        base: '/.data/approvals/',
        type: 'https://example.org/Approval',
        subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
      });

      expect(parsePodResourceRef(chatTable, 'https://alice.example/.data/chat/chat-1/index.ttl#this')).toEqual({
        resourceId: 'chat-1/index.ttl#this',
        templateValues: { id: 'chat-1' },
      });
      expect(parsePodResourceRef(threadTable, 'https://alice.example/.data/chat/chat-1/index.ttl#thread-1')).toEqual({
        resourceId: 'chat-1/index.ttl#thread-1',
        templateValues: { chat: 'chat-1', id: 'thread-1' },
      });
      expect(extractPodResourceTemplateValue(approvalTable, 'https://alice.example/.data/approvals/2026/05/07.ttl#approval-1'))
        .toBe('approval-1');
      expect(parsePodResourceRef(approvalTable, '2026/05/07.ttl#approval-1')).toEqual({
        resourceId: '2026/05/07.ttl#approval-1',
        templateValues: { yyyy: '2026', MM: '05', dd: '07', id: 'approval-1' },
      });
      expect(parsePodResourceRef(approvalTable, 'approval-1')).toBeNull();
      expect(parsePodResourceRef(approvalTable, 'https://alice.example/.data/audits/2026/05/07.ttl#audit-1')).toBeNull();
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

    it('findByIri should read the exact resource document even when a collection SPARQL endpoint exists', async () => {
      const dialect = {
        resolveTableResource: () => ({ mode: 'sparql', endpoint: 'https://example.com/sparql' }),
        executeOnResource: exactSparqlRows.mockResolvedValueOnce([
          { p: 'https://schema.org/name', o: 'Resource Alice' },
        ]),
        getResolver: () => ({
          parseId: (_table: any, subjectUri: string) => subjectUri.split('#').pop(),
        }),
      } as any;

      const exactDb = new PodDatabase(dialect as PodDialect, mockSession as PodAsyncSession);
      const row = await exactDb.findByIri(testTable, 'https://example.com/profile#me');

      expect(row?.name).toBe('Resource Alice');
      expect(exactSparqlRows).toHaveBeenCalledTimes(1);
      expect(exactSparqlRows.mock.calls[0]?.[0]).toBe('https://example.com/profile');
      expect(String(exactSparqlRows.mock.calls[0]?.[1]?.query)).toBe('SELECT ?p ?o WHERE { <https://example.com/profile#me> ?p ?o . }');
      expect(exactSparqlRows.mock.calls[0]?.[2]).toBeUndefined();
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

    it('findByIri should fall back to the resource query pipeline for inline object hydration', async () => {
      const sessionTable = podTable('session', {
        id: id(),
        metadata: object('metadata').predicate('https://undefineds.co/ns#metadata'),
      }, {
        base: 'https://example.com/.data/sessions/',
        type: 'https://undefineds.co/ns#Session',
        subjectTemplate: '{yyyy}/{MM}.ttl#{id}',
      });
      const hydratedRow = {
        id: '2026/04.ttl#session-1',
        metadata: { messageResources: ['2026/04/02/messages.ttl#message-1'] },
      };
      const builder: any = {
        from: () => builder,
        whereByIri: vi.fn().mockImplementation(() => builder),
        limit: () => builder,
        then: (resolve: any) => resolve([hydratedRow]),
      };
      mockSession.select = vi.fn(() => builder);
      const exactDb = new PodDatabase({
        executeOnResource: exactSparqlRows.mockResolvedValueOnce([
          { p: 'https://undefineds.co/ns#metadata', o: 'https://example.com/.data/sessions/2026/04.ttl#metadata-1' },
        ]),
        getResolver: () => ({
          parseId: (_table: any, subjectUri: string) => subjectUri.split('/.data/sessions/').pop(),
        }),
      } as unknown as PodDialect, mockSession as PodAsyncSession);

      const row = await exactDb.findByIri(sessionTable, 'https://example.com/.data/sessions/2026/04.ttl#session-1');

      expect(row).toBe(hydratedRow);
      expect(exactSparqlRows).toHaveBeenCalledTimes(1);
      expect(mockSession.select).toHaveBeenCalled();
      expect(builder.whereByIri).toHaveBeenCalledWith('https://example.com/.data/sessions/2026/04.ttl#session-1');
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

      expect(rows[0]?.id).toBe('chat-1/messages.ttl#msg-123');
      expect(rows[0]?.['@id']).toBe('https://example.com/messages/chat-1/messages.ttl#msg-123');
    });
  });
});
