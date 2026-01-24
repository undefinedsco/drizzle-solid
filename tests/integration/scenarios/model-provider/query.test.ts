/**
 * Scenario: Model Provider (Document mode with fragment subject)
 *
 * This scenario tests a common pattern where:
 * - Resources are stored as individual .ttl files (document mode)
 * - Subject uses a fragment like #this
 * - Template: {id}.ttl#this
 *
 * Bug reproduced: SPARQL endpoint results were missing @id field,
 * causing hydrateInlineColumns to fail with "Cannot resolve relative IRI"
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { drizzle } from '../../../../src/driver';
import { podTable, string, boolean, object, timestamp } from '../../../../src/core/schema';
import { createTestSession, ensureContainer } from '../../css/helpers';
import type { Session } from '@inrupt/solid-client-authn-node';
import type { SolidDatabase } from '../../../../src/driver';

vi.setConfig({ testTimeout: 60_000 });

/**
 * Schema Definition
 *
 * Mimics a real-world AI model provider configuration table
 */
const namespace = {
  prefix: 'app',
  uri: 'https://example.org/ns#',
};

const predicates = {
  status: 'https://example.org/ns#status',
  apiKey: 'https://example.org/ns#apiKey',
  baseUrl: 'https://example.org/ns#baseUrl',
  models: 'https://example.org/ns#models',
  modified: 'http://purl.org/dc/terms/modified',
  ModelProvider: 'https://example.org/ns#ModelProvider',
};

const containerPath = `/integration/scenarios/model-providers-${Date.now()}/`;

const modelProviderTable = podTable('modelProviders', {
  id: string('id').primaryKey(),
  enabled: boolean('enabled').predicate(predicates.status).default(false),
  apiKey: string('apiKey').predicate(predicates.apiKey),
  baseUrl: string('baseUrl').predicate(predicates.baseUrl),
  proxy: string('proxy').predicate(`${namespace.uri}proxy`),
  models: object('models').array().predicate(predicates.models),
  updatedAt: timestamp('updatedAt').predicate(predicates.modified).notNull().defaultNow(),
}, {
  base: containerPath,
  type: predicates.ModelProvider,
  namespace,
  subjectTemplate: '{id}.ttl#this',
  sparqlEndpoint: `${containerPath}-/sparql`,
});

describe('Scenario: Model Provider', () => {
  let session: Session;
  let db: SolidDatabase;
  let containerUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    containerUrl = await ensureContainer(session, containerPath);
    await db.init(modelProviderTable);
  }, 120_000);

  afterAll(async () => {
    // Clean up created resources
    const providers = ['google-gemini', 'openai-gpt', 'anthropic-claude', 'disabled-provider', 'reinserted-provider'];
    for (const id of providers) {
      await session.fetch(`${containerUrl}${id}.ttl`, { method: 'DELETE' }).catch(() => undefined);
    }
    await session.fetch(containerUrl, { method: 'DELETE' }).catch(() => undefined);
  });

  it('should insert model provider with document mode', async () => {
    const providerId = 'google-gemini';

    await db.insert(modelProviderTable).values({
      id: providerId,
      enabled: true,
      apiKey: 'test-api-key-12345',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      proxy: 'http://127.0.0.1:7890',
      models: [{ name: 'gemini-pro', maxTokens: 8192 }],
    });

    // Verify the file was created at the correct location
    const resourceUrl = `${containerUrl}${providerId}.ttl`;
    const response = await session.fetch(resourceUrl);
    expect(response.ok).toBe(true);

    const content = await response.text();
    // Subject should be #this
    expect(content).toContain('#this');
    expect(content).toContain('test-api-key-12345');
    expect(content).toContain('127.0.0.1:7890');
  });

  it('should select model provider and preserve @id', async () => {
    const providers = await db.select().from(modelProviderTable);

    expect(providers.length).toBeGreaterThan(0);

    const provider = providers.find((p: any) => p.id === 'google-gemini');
    expect(provider).toBeDefined();
    expect(provider.enabled).toBe(true);
    expect(provider.apiKey).toBe('test-api-key-12345');
    expect(provider.proxy).toBe('http://127.0.0.1:7890');

    // Verify @id is the full URI (the bug fix)
    expect(provider['@id']).toContain('http');
    expect(provider['@id']).toContain('google-gemini.ttl#this');
  });

  it('should query with WHERE condition (enabled = true)', async () => {
    const { eq } = await import('../../../../src/index');

    // Insert a disabled provider first
    await db.insert(modelProviderTable).values({
      id: 'disabled-provider',
      enabled: false,
      apiKey: 'disabled-key',
      baseUrl: 'https://api.disabled.com/',
      models: [],
    });

    // Query only enabled providers
    const enabledProviders = await db.select()
      .from(modelProviderTable)
      .where(eq(modelProviderTable.enabled, true));

    expect(enabledProviders.length).toBeGreaterThan(0);

    // All results should have enabled = true
    for (const p of enabledProviders) {
      expect(p.enabled).toBe(true);
    }

    // disabled-provider should not be in results
    const disabled = enabledProviders.find((p: any) => p.id === 'disabled-provider');
    expect(disabled).toBeUndefined();
  });

  it('should update model provider', async () => {
    const { eq } = await import('../../../../src/index');

    await db.update(modelProviderTable)
      .set({ enabled: false, baseUrl: 'https://api.example.com/v2/' })
      .where(eq(modelProviderTable.id, 'google-gemini'));

    const updated = await db.select().from(modelProviderTable);
    const provider = updated.find((p: any) => p.id === 'google-gemini');

    expect(provider.enabled).toBe(false);
    expect(provider.baseUrl).toBe('https://api.example.com/v2/');
  });

  it('should insert multiple providers and query all', async () => {
    await db.insert(modelProviderTable).values({
      id: 'openai-gpt',
      enabled: true,
      apiKey: 'sk-openai-key',
      baseUrl: 'https://api.openai.com/v1/',
      models: [],
    });

    await db.insert(modelProviderTable).values({
      id: 'anthropic-claude',
      enabled: false,
      apiKey: 'sk-anthropic-key',
      baseUrl: 'https://api.anthropic.com/',
      models: [],
    });

    const allProviders = await db.select().from(modelProviderTable);
    expect(allProviders.length).toBeGreaterThanOrEqual(3);

    // Verify all providers have proper @id (full URI)
    for (const p of allProviders) {
      expect(p['@id']).toContain('http');
      expect(p['@id']).toContain('.ttl#this');
    }
  });

  it('should delete model provider', async () => {
    const { eq } = await import('../../../../src/index');

    await db.delete(modelProviderTable)
      .where(eq(modelProviderTable.id, 'anthropic-claude'));

    const remaining = await db.select().from(modelProviderTable);
    const deleted = remaining.find((p: any) => p.id === 'anthropic-claude');
    expect(deleted).toBeUndefined();
  });

  it('should support delete + reinsert + query workflow', async () => {
    const { eq } = await import('../../../../src/index');

    // 1. Insert initial data
    await db.insert(modelProviderTable).values({
      id: 'reinserted-provider',
      enabled: true,
      apiKey: 'old-api-key',
      baseUrl: 'https://api.old.com/',
      models: [],
    });

    // 2. Verify initial data
    let providers = await db.select().from(modelProviderTable);
    let provider = providers.find((p: any) => p.id === 'reinserted-provider');
    expect(provider).toBeDefined();
    expect(provider.apiKey).toBe('old-api-key');

    // 3. Delete
    await db.delete(modelProviderTable)
      .where(eq(modelProviderTable.id, 'reinserted-provider'));

    // 4. Verify deletion
    providers = await db.select().from(modelProviderTable);
    provider = providers.find((p: any) => p.id === 'reinserted-provider');
    expect(provider).toBeUndefined();

    // 5. Reinsert with new data
    await db.insert(modelProviderTable).values({
      id: 'reinserted-provider',
      enabled: true,
      apiKey: 'new-api-key',
      baseUrl: 'https://api.new.com/',
      proxy: 'http://new-proxy:8080',
      models: [],
    });

    // 6. Query and verify new data
    providers = await db.select().from(modelProviderTable);
    provider = providers.find((p: any) => p.id === 'reinserted-provider');
    expect(provider).toBeDefined();
    expect(provider.apiKey).toBe('new-api-key');
    expect(provider.baseUrl).toBe('https://api.new.com/');
    expect(provider.proxy).toBe('http://new-proxy:8080');

    // 7. Query with filter still works
    const enabledProviders = await db.select()
      .from(modelProviderTable)
      .where(eq(modelProviderTable.enabled, true));
    const found = enabledProviders.find((p: any) => p.id === 'reinserted-provider');
    expect(found).toBeDefined();
  });
});
