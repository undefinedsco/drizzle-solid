import { describe, expect, it } from 'vitest';
import { eq, inArray } from '@src/core/query-conditions';
import { podTable, string } from '@src/core/schema';
import { ExpressionBuilder } from '@src/core/sparql/builder/expression-builder';
import { UriResolverImpl } from '@src/core/uri';

describe('ExpressionBuilder multi-variable id locator rules', () => {
  const builder = new ExpressionBuilder(new UriResolverImpl('https://pod.example'));

  const Message = podTable('MessageLocatorRule', {
    id: string('id').primaryKey(),
    chatId: string('chatId').predicate('https://schema.org/isPartOf'),
    content: string('content').predicate('https://schema.org/text'),
  }, {
    base: 'https://pod.example/messages/',
    type: 'https://schema.org/Message',
    subjectTemplate: '{chatId}/messages.ttl#{id}',
  });

  it('throws a clear error for eq(id, shortId) without locator variables', () => {
    expect(() => builder.buildWhereClause(eq(Message.id, 'msg-1'), Message))
      .toThrow(/missing required variable\(s\) \[chatId\]/i);
  });

  it('throws a clear error for inArray(id, ...) without locator variables', () => {
    expect(() => builder.buildWhereClause(inArray(Message.id, ['msg-1', 'msg-2']), Message))
      .toThrow(/missing required variable\(s\) \[chatId\]/i);
  });
});
