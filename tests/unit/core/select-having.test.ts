import { describe, expect, it, vi } from 'vitest';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';
import { podTable, string, eq, gt, count, asc } from '@src/index';

const Sales = podTable('Sales', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  category: string('category').predicate('https://schema.org/category'),
}, {
  base: 'https://pod.example/sales.ttl',
  type: 'https://schema.org/Thing',
  subjectTemplate: '#{id}',
});

const Cities = podTable('Cities', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: 'https://pod.example/cities.ttl',
  type: 'https://schema.org/City',
  subjectTemplate: '#{id}',
});

const Residents = podTable('Residents', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  cityId: string('cityId').predicate('https://schema.org/location'),
}, {
  base: 'https://pod.example/residents.ttl',
  type: 'https://schema.org/Person',
  subjectTemplate: '#{id}',
});

describe('SelectQueryBuilder having()', () => {
  const salesRows = [
    { subject: 'https://pod.example/sales.ttl#sale-1', id: 'sale-1', category: 'A' },
    { subject: 'https://pod.example/sales.ttl#sale-2', id: 'sale-2', category: 'A' },
    { subject: 'https://pod.example/sales.ttl#sale-3', id: 'sale-3', category: 'B' },
  ];
  const cityRows = [
    { subject: 'https://pod.example/cities.ttl#city-1', id: 'city-1', name: 'London' },
    { subject: 'https://pod.example/cities.ttl#city-2', id: 'city-2', name: 'Paris' },
    { subject: 'https://pod.example/cities.ttl#city-3', id: 'city-3', name: 'Tokyo' },
  ];
  const residentRows = [
    { subject: 'https://pod.example/residents.ttl#resident-1', id: 'resident-1', name: 'Alice', cityId: 'city-1' },
    { subject: 'https://pod.example/residents.ttl#resident-2', id: 'resident-2', name: 'Bob', cityId: 'city-1' },
    { subject: 'https://pod.example/residents.ttl#resident-3', id: 'resident-3', name: 'Claire', cityId: 'city-2' },
  ];

  const execute = vi.fn(async (operation: any) => {
    const tableName = operation?.table?.config?.name;
    if (tableName === 'Sales') {
      return salesRows;
    }
    if (tableName === 'Cities') {
      return cityRows;
    }
    return [];
  });

  const createSelectBuilder = (rows: Record<string, any>[]) => {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      then: (resolve: (value: Record<string, any>[]) => unknown) => resolve(rows),
    };
    return builder;
  };

  const session: any = {
    execute,
    executeSql: vi.fn(),
    getDialect: () => ({
      getPodUrl: () => 'https://pod.example/',
      getAuthenticatedFetch: () => fetch,
      getUriResolver: () => undefined,
      getTableRegistry: () => new Map(),
      getTableNameRegistry: () => new Map(),
    }),
    select: () => createSelectBuilder(residentRows),
  };

  it('should filter grouped aggregate rows with having aliases', async () => {
    const rows = await new SelectQueryBuilder(session, {
      category: Sales.category,
      total: count(Sales.id),
    })
      .from(Sales)
      .groupBy(Sales.category)
      .having(({ total }) => gt(total, 1))
      .orderBy(asc(Sales.category));

    expect(rows).toEqual([
      { category: 'A', total: 2 },
    ]);
  });

  it('should support having on left-join aggregates via JS fallback', async () => {
    const rows = await new SelectQueryBuilder(session, {
      cityId: Cities.id,
      cityName: Cities.name,
      residentCount: count(Residents.id),
    })
      .from(Cities)
      .leftJoin(Residents, eq(Cities.id, Residents.cityId))
      .groupBy(Cities.id, Cities.name)
      .having(({ residentCount }) => gt(residentCount, 1))
      .orderBy(asc(Cities.name));

    expect(rows).toEqual([
      { cityId: 'city-1', cityName: 'London', residentCount: 2 },
    ]);
  });
});
