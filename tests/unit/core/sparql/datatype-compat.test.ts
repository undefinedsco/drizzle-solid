import { describe, it, expect } from 'vitest';
import { ExpressionBuilder } from '@src/core/sparql/builder/expression-builder';
import { podTable, int } from '@src/index';

// This test checks how filters are generated for numeric literals,
// and whether the underlying engine would treat typed vs untyped numbers differently.

const table = podTable('numbers', {
  id: int('id').primaryKey().predicate('https://example.org/id'),
  value: int('value').predicate('https://example.org/value')
}, {
  base: '/numbers.ttl',
  type: 'https://example.org/Number'
});

const builder = new ExpressionBuilder();

describe('ExpressionBuilder datatype handling', () => {
  it('generates numeric equality without explicit xsd datatype by default', () => {
    const condition = {
      type: 'binary_expr' as const,
      operator: '=',
      column: 'value',
      value: 20
    };

    const expr = builder.buildWhereClause(condition, table);
    expect(expr).toContain('?value = 20');
  });

  it('generates IN list without datatype for numeric literals', () => {
    const condition = {
      type: 'binary_expr' as const,
      operator: 'IN' as const,
      column: 'value',
      value: [10, 20]
    };

    const expr = builder.buildWhereClause(condition, table);
    expect(expr).toContain('?value IN(10, 20)');
  });
});

