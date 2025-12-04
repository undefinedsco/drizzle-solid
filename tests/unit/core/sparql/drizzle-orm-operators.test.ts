import { describe, it, expect } from 'vitest';
import { eq, and, or, gt, lt, gte, lte, inArray, isNull, isNotNull, ne } from 'drizzle-orm';
import { ExpressionBuilder } from '@src/core/sparql/builder/expression-builder';
import { podTable, string, int } from '@src/index';

const table = podTable('users', {
  id: string('id').primaryKey().predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  age: int('age').predicate('https://schema.org/age')
}, {
  base: '/users.ttl',
  type: 'https://schema.org/Person'
});

const builder = new ExpressionBuilder();

describe('ExpressionBuilder with drizzle-orm operators', () => {
  it('handles eq() operator', () => {
    const condition = eq(table.columns.name as any, 'John');
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?name');
    expect(result).toContain('=');
    expect(result).toContain('"John"');
  });

  it('handles gt() operator', () => {
    const condition = gt(table.columns.age as any, 18);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('>');
    expect(result).toContain('18');
  });

  it('handles lt() operator', () => {
    const condition = lt(table.columns.age as any, 65);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('<');
    expect(result).toContain('65');
  });

  it('handles gte() operator', () => {
    const condition = gte(table.columns.age as any, 21);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('>=');
  });

  it('handles lte() operator', () => {
    const condition = lte(table.columns.age as any, 30);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('<=');
  });

  it('handles and() with multiple conditions', () => {
    const condition = and(
      eq(table.columns.name as any, 'John'),
      gt(table.columns.age as any, 18)
    );
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('&&');
    expect(result).toContain('?name');
    expect(result).toContain('?age');
  });

  it('handles or() with multiple conditions', () => {
    const condition = or(
      eq(table.columns.name as any, 'John'),
      eq(table.columns.name as any, 'Jane')
    );
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('||');
  });

  it('handles inArray() operator', () => {
    const condition = inArray(table.columns.age as any, [18, 21, 25]);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('?age');
    expect(result).toContain('IN');
  });

  it('handles isNull() operator', () => {
    const condition = isNull(table.columns.name as any);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('BOUND');
    expect(result).toContain('?name');
  });

  it('handles isNotNull() operator', () => {
    const condition = isNotNull(table.columns.age as any);
    const result = builder.buildWhereClause(condition, table);
    expect(result).toContain('BOUND');
    expect(result).toContain('?age');
  });
});
