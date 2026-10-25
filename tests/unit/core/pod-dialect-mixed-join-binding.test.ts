/**
 * Issue #13 review D3: mixed binding scopes across a join.
 *
 * Contract: each table is routed by ITS OWN per-database resolver outcome.
 * - base bound + joined bound  -> each uses its own bound endpoint
 * - base unbound + joined bound -> base keeps its table/LDP default, joined uses its binding
 * The resolver is consulted per table; no multi-source framework is introduced.
 *
 * Assertions are on the FINAL source URL handed to the executor.
 */
import { describe, expect, it, vi } from 'vitest';
import { drizzle } from '@src/driver';
import { eq } from '@src/core/query-conditions';
import { id, podTable, string } from '@src/core/schema';

const PEOPLE_BASE = 'https://example.com/alice/.data/people/';
const POSTS_BASE = 'https://example.com/alice/.data/posts/';

const people = podTable('people', {
  id: id('id'),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: PEOPLE_BASE,
  type: 'https://schema.org/Person',
  sparqlEndpoint: `${PEOPLE_BASE}-/sparql`,
});

const posts = podTable('posts', {
  id: id('id'),
  author: string('author').predicate('https://schema.org/author'),
  title: string('title').predicate('https://schema.org/headline'),
}, {
  base: POSTS_BASE,
  type: 'https://schema.org/Article',
  sparqlEndpoint: `${POSTS_BASE}-/sparql`,
});

type Resolver = (table: unknown) => string | undefined;

function createDb(resolver?: Resolver) {
  const session: any = {
    info: { isLoggedIn: true, webId: 'https://example.com/alice/profile/card#me' },
    fetch: vi.fn(),
  };
  return drizzle(session, {
    schema: { people, posts },
    podUrl: 'https://example.com/alice/',
    resourcePreparation: 'off',
    ...(resolver ? { sparqlEndpoint: resolver as any } : {}),
  });
}

function captureSources(db: any) {
  const dialect: any = db.dialect;
  const calls: Array<{ source: string; type: string }> = [];
  // Join rows are only fetched when the base query returned rows, so return one
  // base row to make the joined table's query actually execute.
  dialect.sparqlExecutor.executeQueryWithSource = vi.fn(
    async (_query: unknown, source: string, type = 'auto') => {
      calls.push({ source, type });
      if (source.includes('/people/')) {
        return [{ '@id': `${PEOPLE_BASE}alice.ttl#me`, id: 'alice', name: 'Alice' }];
      }
      return [];
    },
  );
  dialect.sparqlExecutor.queryContainer = vi.fn(async (source: string) => {
    calls.push({ source, type: 'ldp-container' });
    if (source.includes('/people/')) {
      return [{ '@id': `${PEOPLE_BASE}alice.ttl#me`, id: 'alice', name: 'Alice' }];
    }
    return [];
  });
  return calls;
}

describe('mixed join binding scopes (D3 contract)', () => {
  it('routes each table through its own bound endpoint when both are bound', async () => {
    const db = createDb((table: any) =>
      table.config.name === 'people'
        ? `${PEOPLE_BASE}room-a/-/sparql`
        : `${POSTS_BASE}room-b/-/sparql`,
    );
    const sources = captureSources(db);

    await db
      .select()
      .from(people)
      .leftJoin(posts, eq(posts.author, people.id));

    const urls = sources.map((entry) => entry.source);
    expect(urls).toContain(`${PEOPLE_BASE}room-a/-/sparql`);
    expect(urls).toContain(`${POSTS_BASE}room-b/-/sparql`);
  });

  it('keeps the base table default when only the joined table is bound', async () => {
    const db = createDb((table: any) =>
      table.config.name === 'posts' ? `${POSTS_BASE}room-b/-/sparql` : undefined,
    );
    const sources = captureSources(db);

    await db
      .select()
      .from(people)
      .leftJoin(posts, eq(posts.author, people.id));

    const urls = sources.map((entry) => entry.source);
    // Joined table uses its own binding.
    expect(urls).toContain(`${POSTS_BASE}room-b/-/sparql`);
    // Base table is declined by the resolver, so it keeps its own table default
    // and is never sent to the joined table's endpoint.
    expect(urls).toContain(`${PEOPLE_BASE}-/sparql`);
    expect(urls).not.toContain(`${POSTS_BASE}-/sparql`);
  });
});
