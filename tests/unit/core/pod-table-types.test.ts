import { describe, it, expectTypeOf } from 'vitest';
import { podTable, string, uri } from '@src/index';

const table = podTable('profiles', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  organization: uri('organization').predicate('https://schema.org/member')
}, {
  base: 'idp:///profiles.ttl',
  rdfClass: 'https://schema.org/Person'
});

type SelectShape = typeof table.$inferSelect;
type InsertShape = typeof table.$inferInsert;
type UpdateShape = typeof table.$inferUpdate;

describe('PodTable type inference', () => {
  it('infers select shape with column keys', () => {
    expectTypeOf<SelectShape>().toEqualTypeOf<{
      id: string;
      name: string;
      organization: string;
    }>();
  });

  it('infers insert shape as optional columns', () => {
    expectTypeOf<InsertShape>().toEqualTypeOf<{
      id?: string;
      name?: string;
      organization?: string;
    }>();
  });

  it('infers update shape as optional nullable columns', () => {
    expectTypeOf<UpdateShape>().toEqualTypeOf<{
      id?: string | null;
      name?: string | null;
      organization?: string | null;
    }>();
  });
});
