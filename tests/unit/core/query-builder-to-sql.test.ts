import { describe, expect, it } from 'vitest';
import { ASTToSPARQLConverter } from '@src/core/ast-to-sparql';
import { SelectQueryBuilder } from '@src/core/query-builders/select-query-builder';
import { InsertQueryBuilder } from '@src/core/query-builders/insert-query-builder';
import { UpdateQueryBuilder } from '@src/core/query-builders/update-query-builder';
import { DeleteQueryBuilder } from '@src/core/query-builders/delete-query-builder';
import { podTable, string, int, eq, gt, count, sum } from '@src/index';

const Users = podTable('Users', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  age: int('age').predicate('https://schema.org/age'),
}, {
  base: 'https://pod.example/users.ttl',
  type: 'https://schema.org/Person',
  subjectTemplate: '#{id}',
});

describe('QueryBuilder toSPARQL()', () => {
  const converter = new ASTToSPARQLConverter('https://pod.example/');
  const session: any = {
    getDialect: () => ({
      getSPARQLConverter: () => converter,
    }),
    execute: async () => [],
    executeSql: async () => [],
    select: () => ({ from: () => ({}) }),
  };

  it('select toSPARQL should build grouped query', () => {
    const query = new SelectQueryBuilder(session, {
      id: Users.id,
      total: count(Users.id),
    })
      .from(Users)
      .groupBy(Users.id)
      .toSPARQL();

    expect(query.type).toBe('SELECT');
    expect(query.query).toContain('SELECT');
    expect(query.query).toContain('GROUP BY');
    expect(query.query).toContain('?id');
    expect(query.prefixes).toBeDefined();
  });

  it('select toSPARQL should preserve DISTINCT aggregate modifiers', () => {
    const query = new SelectQueryBuilder(session, {
      total: sum(Users.age, { distinct: true }),
    })
      .from(Users)
      .toSPARQL();

    expect(query.type).toBe('SELECT');
    expect(query.query).toContain('DISTINCT');
    expect(query.query).toContain('?age');
  });

  it('toSparql should alias to toSPARQL', () => {
    const builder = new InsertQueryBuilder(session, Users)
      .values({ id: 'user-1', name: 'Alice', age: 20 });

    expect(builder.toSparql()).toEqual(builder.toSPARQL());
  });

  it('builders should no longer expose toSQL compatibility alias', () => {
    expect('toSQL' in new SelectQueryBuilder(session)).toBe(false);
    expect('toSQL' in new InsertQueryBuilder(session, Users)).toBe(false);
    expect('toSQL' in new UpdateQueryBuilder(session, Users)).toBe(false);
    expect('toSQL' in new DeleteQueryBuilder(session, Users)).toBe(false);
  });

  it('select toSPARQL should reject join queries for now', () => {
    expect(() =>
      new SelectQueryBuilder(session)
        .from(Users)
        .leftJoin(Users, eq(Users.id, Users.id))
        .toSPARQL()
    ).toThrow('toSPARQL() is not yet supported for JOIN queries in Solid dialect');
  });

  it('select toSPARQL should build HAVING for grouped aggregate query', () => {
    const builder = new SelectQueryBuilder(session, {
      id: Users.id,
      total: count(Users.id),
    })
      .from(Users)
      .groupBy(Users.id)
      .having(({ total }) => gt(total, 1));

    const sparql = builder.toSPARQL();

    expect(sparql.query).toContain('HAVING');
    expect(sparql.query).toContain('COUNT');
  });

  it('select toSPARQL should reject structured selections for now', () => {
    expect(() =>
      new SelectQueryBuilder(session, {
        user: {
          id: Users.id,
          name: Users.name,
        },
      })
        .from(Users)
        .toSPARQL()
    ).toThrow('toSPARQL() does not support structured selections in Solid dialect');
  });

  it('insert toSPARQL should build SPARQL update', () => {
    const query = new InsertQueryBuilder(session, Users)
      .values({ id: 'user-1', name: 'Alice', age: 20 })
      .toSPARQL();

    expect(query.type).toBe('INSERT');
    expect(query.query).toContain('INSERT DATA');
    expect(query.query).toContain('Alice');
  });

  it('update toSPARQL should build SPARQL update', () => {
    const query = new UpdateQueryBuilder(session, Users)
      .set({ age: 21 })
      .where(eq(Users.id, 'user-1'))
      .toSPARQL();

    expect(query.type).toBe('UPDATE');
    expect(query.query).toContain('DELETE');
    expect(query.query).toContain('INSERT');
    expect(query.query).toContain('user-1');
  });

  it('delete toSPARQL should build SPARQL delete', () => {
    const query = new DeleteQueryBuilder(session, Users)
      .where(eq(Users.id, 'user-1'))
      .toSPARQL();

    expect(query.type).toBe('DELETE');
    expect(query.query).toContain('DELETE');
    expect(query.query).toContain('user-1');
  });
});
