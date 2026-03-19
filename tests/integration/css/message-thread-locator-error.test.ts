import { beforeAll, describe, expect, it, vi } from 'vitest';
import { drizzle, podTable, string, uri } from '../../../src';
import { createTestSession, ensureContainer } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const SIOC = {
  has_parent: 'http://rdfs.org/sioc/ns#has_parent',
  thread: 'http://rdfs.org/sioc/ns#Thread',
};
const Meeting = {
  LongChat: 'http://www.w3.org/ns/pim/meeting#LongChat',
};
const UDFS_NAMESPACE = { prefix: 'udfs', uri: 'https://undefineds.co/ns#' };

describe('SPARQL path locator errors for multi-variable templates', () => {
  let session: any;
  let db: any;
  let containerUrl: string;
  let Chat: any;
  let Thread: any;

  beforeAll(async () => {
    session = await createTestSession();
    containerUrl = await ensureContainer(session, `integration/message-thread-locator-${Date.now()}/`);

    Chat = podTable(
      'ChatLocatorError',
      {
        id: string('id').primaryKey(),
        title: string('title'),
      },
      {
        base: `${containerUrl}chat/`,
        type: Meeting.LongChat,
        namespace: UDFS_NAMESPACE,
        subjectTemplate: '{id}/index.ttl#this',
        sparqlEndpoint: `${containerUrl}chat/-/sparql`,
      },
    );

    Thread = podTable(
      'ThreadLocatorError',
      {
        id: string('id').primaryKey(),
        chatId: uri('chatId').predicate(SIOC.has_parent).link(Chat),
        title: string('title'),
      },
      {
        base: `${containerUrl}chat/`,
        type: SIOC.thread,
        namespace: UDFS_NAMESPACE,
        subjectTemplate: '{chatId}/index.ttl#{id}',
        sparqlEndpoint: `${containerUrl}chat/-/sparql`,
      },
    );

    db = drizzle(session, { schema: { Chat, Thread } });
  });

  it('fails clearly when locator is incomplete on multi-variable tables', async () => {
    await expect(
      db.findByLocator(Thread, { id: 'thread-1' })
    ).rejects.toThrow(/Missing \[chatId\]/i);
  });
});
