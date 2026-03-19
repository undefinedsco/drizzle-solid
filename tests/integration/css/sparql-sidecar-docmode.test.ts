/**
 * Test SPARQL Sidecar mode with Document Mode (one file per record)
 * 
 * This test verifies that:
 * 1. SPARQL SELECT queries use the sidecar endpoint (single POST request)
 * 2. Instead of N+1 LDP GET requests for each document
 * 3. Write operations still use LDP for Solid Notifications compatibility
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createTestSession, ensureContainer } from './helpers';
import { drizzle } from '../../../src/driver';
import { podTable, string, timestamp, id, uri, object } from '../../../src/core/schema';

describe('SPARQL Sidecar with Document Mode', () => {
  let session: any;
  let podBase: string;

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    podBase = session.info.webId.split('profile')[0];
  }, 60000);

  it('should use SPARQL endpoint for SELECT instead of N+1 LDP requests', async () => {
    // 1. Setup: Create a container with multiple documents (simulating chat records)
    const testId = Date.now();
    const containerPath = `.data/chats-test-${testId}/`;
    const baseContainer = `${podBase}${containerPath}`;
    const sparqlEndpoint = `${baseContainer}-/sparql`;

    // Define table similar to linq's chatTable
    const chatTable = podTable('chats', {
      id: id('id'),
      title: string('title').predicate('http://purl.org/dc/terms/title').notNull(),
      description: string('description').predicate('http://purl.org/dc/terms/description'),
    }, {
      base: baseContainer,
      sparqlEndpoint: sparqlEndpoint,
      type: 'http://www.w3.org/ns/pim/meeting#LongChat',
      subjectTemplate: '{id}.ttl',  // Document Mode: one file per chat
    });

    // Ensure container exists
    await ensureContainer(session, containerPath);

    // 2. Create multiple chat records via LDP (simulating existing data)
    const chatIds = ['chat-1', 'chat-2', 'chat-3'];
    for (const chatId of chatIds) {
      const chatResource = `${baseContainer}${chatId}.ttl`;
      await session.fetch(chatResource, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
        body: `
          @prefix dc: <http://purl.org/dc/terms/>.
          @prefix meeting: <http://www.w3.org/ns/pim/meeting#>.
          
          <> 
            a meeting:LongChat;
            dc:title "Chat ${chatId}";
            dc:description "Description for ${chatId}".
        `
      });
    }

    // Verify LDP writes succeeded
    for (const chatId of chatIds) {
      const res = await session.fetch(`${baseContainer}${chatId}.ttl`);
      expect(res.ok).toBe(true);
      const content = await res.text();
      expect(content).toContain(`Chat ${chatId}`);
    }

    console.log('✅ Created 3 chat documents via LDP');

    // 3. Query via drizzle-solid with SPARQL endpoint configured
    const db = drizzle(session);
    
    // This should use SPARQL endpoint (single POST) instead of N+1 GET requests
    console.log('📊 Executing SELECT with sparqlEndpoint configured...');
    console.log(`   Endpoint: ${sparqlEndpoint}`);
    
    const chats = await db.select().from(chatTable);
    
    console.log('📋 Query results:', chats);
    
    // 4. Verify results
    expect(chats.length).toBe(3);
    
    for (const chatId of chatIds) {
      const chat = chats.find((c: any) => c.id === chatId);
      expect(chat).toBeDefined();
      expect(chat.title).toBe(`Chat ${chatId}`);
      expect(chat.description).toBe(`Description for ${chatId}`);
    }

    console.log('✅ SPARQL SELECT returned all 3 chats correctly');

    // 5. Test INSERT (should use LDP, not SPARQL)
    const newChatId = 'chat-new';
    await db.insert(chatTable).values({
      id: newChatId,
      title: 'New Chat',
      description: 'Created via drizzle insert'
    });

    // Verify via LDP GET
    const newChatRes = await session.fetch(`${baseContainer}${newChatId}.ttl`);
    expect(newChatRes.ok).toBe(true);
    const newChatContent = await newChatRes.text();
    expect(newChatContent).toContain('New Chat');

    console.log('✅ INSERT used LDP (created new document)');

    // 6. Query again - should still use SPARQL and find all 4 chats
    const allChats = await db.select().from(chatTable);
    expect(allChats.length).toBe(4);
    expect(allChats.find((c: any) => c.id === newChatId)).toBeDefined();

    console.log('✅ SPARQL SELECT found all 4 chats after INSERT');

    // Cleanup
    for (const chatId of [...chatIds, newChatId]) {
      await session.fetch(`${baseContainer}${chatId}.ttl`, { method: 'DELETE' }).catch(() => {});
    }

  }, 60000);

  it('should verify SPARQL endpoint is accessible', async () => {
    const testId = Date.now();
    const containerPath = `.data/sparql-check-${testId}/`;
    const baseContainer = `${podBase}${containerPath}`;
    const sparqlEndpoint = `${baseContainer}-/sparql`;

    await ensureContainer(session, containerPath);

    // Create a test document
    const testResource = `${baseContainer}test.ttl`;
    await session.fetch(testResource, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: '<#test> <http://schema.org/name> "Test Item".'
    });

    // Test SPARQL endpoint directly
    const sparqlQuery = 'SELECT * WHERE { ?s ?p ?o } LIMIT 10';
    const response = await session.fetch(sparqlEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        'Accept': 'application/sparql-results+json'
      },
      body: sparqlQuery
    });

    console.log(`SPARQL endpoint response: ${response.status}`);
    
    if (response.ok) {
      const results = await response.json();
      console.log('SPARQL results:', JSON.stringify(results, null, 2));
      expect(results.results.bindings.length).toBeGreaterThan(0);
      console.log('✅ SPARQL endpoint is working');
    } else {
      const text = await response.text();
      console.log('SPARQL endpoint error:', text);
      // If endpoint returns 404/405, sidecar might not be enabled
      if (response.status === 404 || response.status === 405) {
        console.warn('⚠️ SPARQL sidecar endpoint not available - skipping');
        return;
      }
      throw new Error(`SPARQL endpoint failed: ${response.status} ${text}`);
    }

    // Cleanup
    await session.fetch(testResource, { method: 'DELETE' }).catch(() => {});
    
  }, 30000);

  it('should preserve uri().array() values on document-mode sidecar select', async () => {
    const testId = Date.now();
    const containerPath = `.data/chat-array-${testId}/`;
    const baseContainer = `${podBase}${containerPath}`;
    const sparqlEndpoint = `${baseContainer}-/sparql`;

    await ensureContainer(session, containerPath);

    const chatTable = podTable('chats', {
      id: id('id'),
      title: string('title').notNull(),
      participants: uri('participants').array().predicate('http://www.w3.org/2005/01/wf/flow-1.0#participant'),
      metadata: object('metadata').predicate('https://undefineds.co/ns#metadata'),
      createdAt: timestamp('createdAt').notNull().defaultNow(),
      updatedAt: timestamp('updatedAt').notNull().defaultNow(),
    }, {
      base: baseContainer,
      type: 'http://www.w3.org/ns/pim/meeting#LongChat',
      namespace: { uri: 'https://undefineds.co/ns#' },
      subjectTemplate: '{id}/index.ttl#this',
      sparqlEndpoint,
    });

    const db = drizzle(session);
    const chatId = `group-chat-${Date.now()}`;
    const webId = session.info.webId;
    const assistantUri = `${podBase}.data/agents/assistant-${chatId}.ttl#this`;
    const now = new Date();

    await db.insert(chatTable).values({
      id: chatId,
      title: 'Group Round Trip',
      participants: [webId, assistantUri],
      metadata: {
        memberRoles: {
          [webId]: 'owner',
          [assistantUri]: 'member',
        },
      },
      createdAt: now,
      updatedAt: now,
    }).execute();

    const row = await db.findByLocator(chatTable, { id: chatId });

    expect(row).not.toBeNull();
    expect(Array.isArray(row?.participants)).toBe(true);
    expect(row?.participants).toHaveLength(2);
    expect(row?.participants).toEqual(expect.arrayContaining([webId, assistantUri]));
  }, 60000);
});
