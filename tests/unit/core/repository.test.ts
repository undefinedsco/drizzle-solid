import { describe, expect, it } from 'vitest';
import { createRepositoryDescriptor, type SolidDatabase } from '../../../src';
import { podTable, string, timestamp, id } from '../../../src/core/schema';

const chatTable = podTable('chat', {
  id: id(),
  title: string('title').predicate('https://schema.org/name'),
  description: string('description').predicate('https://schema.org/description'),
  lastActiveAt: timestamp('lastActiveAt').predicate('https://schema.org/dateModified'),
}, {
  base: 'https://pod.example/.data/chat/',
  type: 'https://example.org/Chat',
  subjectTemplate: '{id}/index.ttl#this',
});

type ChatRow = typeof chatTable.$inferSelect & { '@id'?: string };
type ChatInsert = typeof chatTable.$inferInsert;
type ChatUpdate = typeof chatTable.$inferUpdate;

class MockSelectBuilder<Row> {
  whereArgs: unknown[] = [];
  orderArgs: unknown[] = [];

  constructor(private readonly rows: Row[]) {}

  where(arg: unknown) {
    this.whereArgs.push(arg);
    return this;
  }

  orderBy(...args: unknown[]) {
    this.orderArgs.push(args);
    return this;
  }

  async execute() {
    return this.rows;
  }
}

class MockDatabase<Row extends Record<string, unknown>> {
  lastSelectQuery: MockSelectBuilder<Row> | null = null;
  lastInsertInput: unknown = null;
  updatedByIri: Array<{ iri: string; data: Record<string, unknown> }> = [];
  deletedByIri: string[] = [];

  constructor(private selectRows: Row[] = [], private insertRow?: Row) {}

  select() {
    return {
      from: () => {
        const builder = new MockSelectBuilder<Row>(this.selectRows);
        this.lastSelectQuery = builder;
        return builder;
      },
    };
  }

  insert() {
    return {
      values: (input: unknown) => {
        this.lastInsertInput = input;
        return {
          execute: async () => [
            this.insertRow ?? {
              success: true,
              source: `https://pod.example/.data/chat/${String((input as Record<string, unknown>).id)}/index.ttl#this`,
            },
          ],
        };
      },
    };
  }

  async findByIri(_table: unknown, iri: string) {
    return this.selectRows.find((row) => row['@id'] === iri) ?? null;
  }

  async updateByIri(_table: unknown, iri: string, data: Record<string, unknown>) {
    this.updatedByIri.push({ iri, data });
    return this.selectRows.find((row) => row['@id'] === iri) ?? null;
  }

  async deleteByIri(_table: unknown, iri: string) {
    this.deletedByIri.push(iri);
    return true;
  }

  resolveRowIri(_table: unknown, row: Record<string, unknown>) {
    if (typeof row['@id'] === 'string') return row['@id'];
    return `https://pod.example/.data/chat/${String(row.id)}/index.ttl#this`;
  }

  resolveRowId(_table: unknown, row: Record<string, unknown>) {
    const iri = typeof row['@id'] === 'string' ? row['@id'] : this.resolveRowIri(_table, row);
    return iri.replace('https://pod.example/.data/chat/', '').replace('/index.ttl#this', '');
  }
}

const descriptor = createRepositoryDescriptor<
  typeof chatTable,
  ChatRow,
  ChatInsert,
  ChatUpdate
>({
  namespace: 'chat',
  table: chatTable,
  searchableFields: ['title', 'description'],
  defaultSort: { field: 'lastActiveAt', direction: 'desc' },
});

const baseChatRow: ChatRow = {
  id: 'chat-1',
  '@id': 'https://pod.example/.data/chat/chat-1/index.ttl#this',
  title: 'Sample Chat',
  description: 'Hello world',
  lastActiveAt: new Date('2026-05-12T00:00:00Z'),
};

describe('createRepositoryDescriptor', () => {
  it('applies search filters and sorting for list queries', async () => {
    const db = new MockDatabase<ChatRow>([baseChatRow]);

    const rows = await descriptor.list(db as unknown as SolidDatabase, { search: 'Sample' });

    expect(rows).toEqual([baseChatRow]);
    expect(db.lastSelectQuery?.whereArgs.length).toBe(1);
    expect(db.lastSelectQuery?.orderArgs.length).toBe(1);
  });

  it('returns matching rows via exact IRI detail lookup', async () => {
    const db = new MockDatabase<ChatRow>([baseChatRow]);

    const row = await descriptor.detail(db as unknown as SolidDatabase, baseChatRow['@id']!);

    expect(row).toEqual(baseChatRow);
    expect(db.lastSelectQuery).toBeNull();
  });

  it('creates rows and returns ORM row identity fields', async () => {
    const db = new MockDatabase<ChatRow>([]);

    const created = await descriptor.create?.(db as unknown as SolidDatabase, {
      id: 'chat-99',
      title: 'New Chat',
      description: 'demo',
      lastActiveAt: new Date('2026-05-12T00:00:00Z'),
    });

    expect(created).toMatchObject({
      id: 'chat-99',
      '@id': 'https://pod.example/.data/chat/chat-99/index.ttl#this',
      subject: 'https://pod.example/.data/chat/chat-99/index.ttl#this',
      uri: 'https://pod.example/.data/chat/chat-99/index.ttl#this',
      source: 'https://pod.example/.data/chat/chat-99/index.ttl#this',
    });
    expect(db.lastInsertInput).toMatchObject({ title: 'New Chat' });
  });

  it('updates and removes rows through ORM exact IRI APIs', async () => {
    const updatedRow = { ...baseChatRow, title: 'Updated' };
    const db = new MockDatabase<ChatRow>([updatedRow]);

    await descriptor.update?.(db as unknown as SolidDatabase, baseChatRow['@id']!, {
      title: 'Updated',
    });
    await descriptor.remove?.(db as unknown as SolidDatabase, baseChatRow['@id']!);

    expect(db.updatedByIri).toEqual([{
      iri: baseChatRow['@id'],
      data: { title: 'Updated' },
    }]);
    expect(db.deletedByIri).toEqual([baseChatRow['@id']]);
  });
});
