import { describe, it, expectTypeOf } from 'vitest';
import { podTable, string, uri, json, int, boolean, date, object } from '@src/index';
import { extendNamespace } from '@src/utils/namespace';
import { SCHEMA_INRUPT as BASE_SCHEMA } from '@inrupt/vocab-common-rdf';

const SCHEMA = extendNamespace(BASE_SCHEMA, {});

const profileTable = podTable('profiles', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').notNull().predicate('https://schema.org/name'),
  nickname: string('nickname').predicate('https://schema.org/alternateName'),
  homepage: uri('homepage').predicate('https://schema.org/url'),
  metadata: json('metadata').default({}).predicate('https://schema.org/additionalProperty'),
  contactUris: uri('contactUris')
    .array()
    .predicate('https://schema.org/knows')
}, {
  base: 'idp:///profiles.ttl',
  type: 'https://schema.org/Person',
  namespace: SCHEMA
});

const primitiveTable = podTable('primitive', {
  id: string('id').primaryKey(),
  score: int('score').notNull(),
  flag: boolean('flag'),
  publishedAt: date('publishedAt').defaultNow(),
  extra: object('extra').default({ foo: 'bar' })
}, {
  base: 'idp:///primitive.ttl',
  type: 'https://schema.org/Thing',
  namespace: SCHEMA
});

const threadTable = podTable('threads', {
  id: string('id').primaryKey(),
  messageRefs: uri('messageRefs')
    .array()
    .predicate('https://www.w3.org/ns/sioc#has_member')
    .inverse()
    .link('https://schema.org/Message')
}, {
  base: 'idp:///threads.ttl',
  type: 'https://schema.org/Conversation',
  namespace: SCHEMA
});

type ProfileSelect = typeof profileTable.$inferSelect;
type ProfileInsert = typeof profileTable.$inferInsert;
type ProfileUpdate = typeof profileTable.$inferUpdate;

type PrimitiveSelect = typeof primitiveTable.$inferSelect;
type PrimitiveInsert = typeof primitiveTable.$inferInsert;
type PrimitiveUpdate = typeof primitiveTable.$inferUpdate;

type ThreadSelect = typeof threadTable.$inferSelect;

describe('PodTable type inference', () => {
  it('provides concrete field types for select', () => {
    expectTypeOf<ProfileSelect>().toEqualTypeOf<{
      id: string;
      name: string;
      nickname: string;
      homepage: string;
      metadata: unknown;
      contactUris: string[];
    }>();
  });

  it('requires non-null/non-default columns on insert', () => {
    expectTypeOf<ProfileInsert>().toEqualTypeOf<{
      id: string;
      name: string;
      nickname?: string;
      homepage?: string;
      metadata?: unknown;
      contactUris?: string[];
    }>();
  });

  it('allows null assignments only for nullable columns on update', () => {
    expectTypeOf<ProfileUpdate>().toEqualTypeOf<{
      id?: string;
      name?: string;
      nickname?: string | null;
      homepage?: string | null;
      metadata?: unknown | null;
      contactUris?: string[] | null;
    }>();
  });

  it('keeps uri array columns inferred as string arrays', () => {
    expectTypeOf<ThreadSelect>().toEqualTypeOf<{
      id: string;
      messageRefs: string[];
    }>();
  });

  it('infers primitives for select correctly', () => {
    expectTypeOf<PrimitiveSelect>().toEqualTypeOf<{
      id: string;
      score: number;
      flag: boolean;
      publishedAt: Date;
      extra: Record<string, unknown>;
    }>();
  });

  it('lets select builder return inferred types when bound to schema', () => {
    const mockSession = {
      select: () => ({
        from: () => ({
          execute: async () => [] as Array<typeof profileTable.$inferSelect>
        })
      })
    } as any;

    const rowsPromise = (mockSession.select() as any)
      .from(profileTable)
      .execute() as Promise<typeof profileTable.$inferSelect[]>;

    expectTypeOf(rowsPromise).toEqualTypeOf<Promise<{ id: string; name: string; nickname: string; homepage: string; metadata: unknown; contactUris: string[] }[]>>();
  });
});
