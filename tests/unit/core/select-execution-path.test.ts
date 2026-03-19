import { describe, expect, it } from 'vitest';
import { ASTToSPARQLConverter } from '@src/core/ast-to-sparql';
import { and, eq, inArray } from '@src/core/query-conditions';
import { podTable, string, uri } from '@src/core/schema';

const podUrl = 'https://example.com';
const converter = new ASTToSPARQLConverter(podUrl);

const WideTable = podTable('WideExecutionPath', {
  id: string('id').primaryKey(),
  name: string('name').predicate('http://schema.org/name').notNull(),
  category: string('category').predicate('http://schema.org/category'),
  tags: string('tags').array().predicate('http://schema.org/keywords'),
  summary: string('summary').predicate('http://schema.org/description'),
  opt1: string('opt1').predicate('https://example.com/ns#opt1'),
  opt2: string('opt2').predicate('https://example.com/ns#opt2'),
  opt3: string('opt3').predicate('https://example.com/ns#opt3'),
  opt4: string('opt4').predicate('https://example.com/ns#opt4'),
}, {
  type: 'http://schema.org/Thing',
  base: `${podUrl}/data/wide-execution/`,
  subjectTemplate: '{id}.ttl',
});

const Chat = podTable('ChatExecutionPath', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/name').notNull(),
}, {
  type: 'http://example.com/Chat',
  base: `${podUrl}/data/chats/`,
  subjectTemplate: '{id}.ttl',
});

const Thread = podTable('ThreadExecutionPath', {
  id: string('id').primaryKey(),
  chatId: uri('chatId').predicate('http://rdfs.org/sioc/ns#has_parent').link(Chat),
  title: string('title').predicate('http://schema.org/name'),
}, {
  type: 'http://example.com/Thread',
  base: `${podUrl}/data/threads/`,
  subjectTemplate: '{id}.ttl',
});

describe('select execution-path coverage', () => {
  it('keeps single-id lookups on wide document tables as FILTER, not VALUES', () => {
    const query = converter.convertSimpleSelect(
      { table: WideTable, where: eq(WideTable.id, 'row-1') as any },
      undefined,
      undefined,
      false,
    ).query;

    expect(query).toContain('FILTER(?subject =');
    expect(query).not.toContain('VALUES ?subject');
    expect((query.match(/\bOPTIONAL\b/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('uses VALUES for multi-id lookups and keeps filtered optional columns required', () => {
    const query = converter.convertSimpleSelect(
      {
        table: WideTable,
        where: and(
          inArray(WideTable.id, ['row-1', 'row-2']),
          eq(WideTable.category, 'tech'),
        ) as any,
      },
      undefined,
      undefined,
      false,
    ).query;

    expect(query).toContain('VALUES ?subject');
    expect(query).toContain('?category');
    expect(query).toContain('"tech"');
    expect(query).toContain('<http://schema.org/category> ?category');
    expect(query).not.toContain('OPTIONAL { ?subject <http://schema.org/category> ?category');
  });

  it('formats link-field IN filters as named nodes instead of string literals', () => {
    const query = converter.convertSimpleSelect(
      {
        table: Thread,
        where: inArray(Thread.chatId, ['chat-1', 'chat-2']) as any,
      },
      undefined,
      undefined,
      false,
    ).query;

    expect(query).toContain('?chatId IN');
    expect(query).toContain('<https://example.com/data/chats/chat-1.ttl>');
    expect(query).toContain('<https://example.com/data/chats/chat-2.ttl>');
    expect(query).not.toContain('"chat-1"');
    expect(query).not.toContain('"chat-2"');
    expect(query).toContain('<http://rdfs.org/sioc/ns#has_parent> ?chatId');
    expect(query).not.toContain('OPTIONAL { ?subject <http://rdfs.org/sioc/ns#has_parent> ?chatId');
  });
});
