import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Session } from '@inrupt/solid-client-authn-node';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  date,
  regex,
  or
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import { createTestSession, ensureContainer } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const credentialsContainerPath = `/.data/credentials/${Date.now()}/`;

const credentialTable = podTable('credentials', {
  id: string('id').primaryKey().predicate('https://linq.ai/ns#credentialId'),
  name: string('name').notNull().predicate('http://purl.org/dc/terms/title'),
  description: string('description').predicate('http://purl.org/dc/terms/description'),
  updatedAt: date('updatedAt').notNull().predicate('http://purl.org/dc/terms/modified')
}, {
  base: `${credentialsContainerPath}credentials.ttl`,
  type: 'https://linq.ai/ns#credential'
});

type SearchFilters = { search?: string };

describe('CSS integration: credential repository search filters', () => {
  let session: Session;
  let db: SolidDatabase;
  let containerUrl: string;
  let resourceUrl: string;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    containerUrl = await ensureContainer(session, credentialsContainerPath);
    resourceUrl = `${containerUrl}credentials.ttl`;
    await db.init(credentialTable);
  }, 120_000);

  afterAll(async () => {
    if (resourceUrl) {
      await session.fetch(resourceUrl, { method: 'DELETE' }).catch(() => undefined);
    }
    if (containerUrl) {
      await session.fetch(containerUrl, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  const queryCredentials = async (filters?: SearchFilters) => {
    const baseQuery = db
      .select({
        name: credentialTable.name,
        description: credentialTable.description,
        updatedAt: credentialTable.updatedAt
      })
      .from(credentialTable)
      .orderBy(credentialTable.updatedAt, 'desc');

    const searchValue = filters?.search?.trim();
    if (searchValue) {
      baseQuery.where(
        or(
          regex(credentialTable.name, searchValue, 'i'),
          regex(credentialTable.description, searchValue, 'i')
        )
      );
    }

    return await baseQuery;
  };

  const resetResource = async () => {
    // Try to delete resource
    for (let i = 0; i < 3; i++) {
      try {
        const response = await session.fetch(resourceUrl, { method: 'DELETE' });
        if (response.status === 404 || response.ok) {
          // Verify it's gone
          const check = await session.fetch(resourceUrl, { method: 'HEAD' });
          if (check.status === 404) return;
        }
      } catch (e) {
        console.warn(`[resetResource] Error deleting resource:`, e);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.warn(`[resetResource] Failed to ensure resource deletion: ${resourceUrl}`);
  };

  test('applies search filter across configured searchable fields', async () => {
    await resetResource();

    await db.insert(credentialTable).values([
      {
        id: 'cred-openai-updated',
        name: 'OpenAI Managed Credential',
        description: 'Used for OpenAI Workspace integrations',
        updatedAt: new Date(Date.now())
      },
      {
        id: 'cred-openai-desc',
        name: 'Credential Without Keyword',
        description: 'Grants OpenAI sandbox access',
        updatedAt: new Date(Date.now() - 5_000)
      },
      {
        id: 'cred-external',
        name: 'Partner Credential',
        description: 'Used for partner specific resources',
        updatedAt: new Date(Date.now() - 10_000)
      }
    ]);

    const results = await queryCredentials({ search: 'openai' });

    expect(results.map((row) => row.name)).toEqual([
      'OpenAI Managed Credential',
      'Credential Without Keyword'
    ]);
  });

  test('skips search filter when search term is empty', async () => {
    await resetResource();

    await db.insert(credentialTable).values([
      {
        id: 'cred-one',
        name: 'Alpha Credential',
        description: 'Primary credential',
        updatedAt: new Date(Date.now())
      },
      {
        id: 'cred-two',
        name: 'Beta Credential',
        description: 'Secondary credential',
        updatedAt: new Date(Date.now() - 1_000)
      }
    ]);

    const withoutSearch = await queryCredentials();
    const emptySearch = await queryCredentials({ search: '   ' });

    const names = withoutSearch.map((row) => row.name);

    expect(names).toEqual(['Alpha Credential', 'Beta Credential']);
    expect(emptySearch.map((row) => row.name)).toEqual(names);
  });
});
