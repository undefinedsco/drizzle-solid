import { describe, expect, it, vi } from 'vitest';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';
import { podTable, string, int, count, sum, avg, min, max } from '@src/index';

const Metrics = podTable('Metrics', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  nullableMetric: int('nullableMetric').predicate('https://example.org/ns#nullableMetric'),
}, {
  base: 'https://pod.example/metrics.ttl',
  type: 'https://schema.org/Thing',
  subjectTemplate: '#{id}',
});

describe('SelectQueryBuilder aggregate distinct fallback', () => {
  const execute = vi.fn().mockResolvedValue([
    { subject: 'https://pod.example/metrics.ttl#item-1', id: 'item-1', nullableMetric: 2 },
    { subject: 'https://pod.example/metrics.ttl#item-2', id: 'item-2', nullableMetric: undefined },
    { subject: 'https://pod.example/metrics.ttl#item-3', id: 'item-3', nullableMetric: 4 },
    { subject: 'https://pod.example/metrics.ttl#item-4', id: 'item-4', nullableMetric: undefined },
    { subject: 'https://pod.example/metrics.ttl#item-5', id: 'item-5', nullableMetric: 4 },
  ]);

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
    select: () => ({ from: () => ({}) }),
  };

  it('should dedupe duplicate numeric values for distinct aggregates', async () => {
    const rows = await new SelectQueryBuilder(session, {
      countDistinct: count(Metrics.nullableMetric, { distinct: true }),
      sumDistinct: sum(Metrics.nullableMetric, { distinct: true }),
      avgDistinct: avg(Metrics.nullableMetric, { distinct: true }),
      minDistinct: min(Metrics.nullableMetric, { distinct: true }),
      maxDistinct: max(Metrics.nullableMetric, { distinct: true }),
    }).from(Metrics);

    expect(rows).toEqual([{
      countDistinct: 2,
      sumDistinct: 6,
      avgDistinct: 3,
      minDistinct: 2,
      maxDistinct: 4,
    }]);
  });

  it('should return null for distinct numeric aggregates over null-only columns', async () => {
    const nullOnlySession: any = {
      ...session,
      execute: vi.fn().mockResolvedValue([
        { subject: 'https://pod.example/metrics.ttl#item-1', id: 'item-1', nullableMetric: null },
        { subject: 'https://pod.example/metrics.ttl#item-2', id: 'item-2', nullableMetric: undefined },
      ]),
    };

    const rows = await new SelectQueryBuilder(nullOnlySession, {
      countDistinct: count(Metrics.nullableMetric, { distinct: true }),
      sumDistinct: sum(Metrics.nullableMetric, { distinct: true }),
      avgDistinct: avg(Metrics.nullableMetric, { distinct: true }),
      minDistinct: min(Metrics.nullableMetric, { distinct: true }),
      maxDistinct: max(Metrics.nullableMetric, { distinct: true }),
    }).from(Metrics);

    expect(rows).toEqual([{
      countDistinct: 0,
      sumDistinct: null,
      avgDistinct: null,
      minDistinct: null,
      maxDistinct: null,
    }]);
  });
});
