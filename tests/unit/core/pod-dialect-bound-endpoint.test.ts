/**
 * Issue #13: per-database collection SELECT endpoint binding.
 *
 * These tests are URL/selection-level only. Live acceptance is covered by
 * tests/integration/css/issue-13-room-scoped-select.test.ts against real CSS.
 */
import { describe, expect, it, vi } from 'vitest';
import { PodDialect } from '@src/core/pod-dialect';
import { PodExecutor } from '@src/core/execution/pod-executor';
import { podTable, string } from '@src/core/schema';
import type { PodTable } from '@src/core/schema';

const createSession = () => ({
  info: {
    isLoggedIn: true,
    webId: 'https://example.com/alice/profile/card#me',
  },
  fetch: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
});

const createTable = () =>
  podTable('chat', {
    id: string('id').primaryKey().predicate('https://schema.org/identifier'),
    title: string('title').predicate('https://schema.org/name'),
  }, {
    base: 'https://example.com/alice/.data/chat/',
    type: 'https://schema.org/Thing',
    sparqlEndpoint: 'https://example.com/alice/.data/chat/-/sparql',
  });

describe('PodDialect.resolveBoundSelectEndpoint', () => {
  it('is undefined when no binding is configured (unchanged default behavior)', () => {
    const dialect = new PodDialect({ session: createSession() });
    const table = createTable();

    expect(dialect.resolveBoundSelectEndpoint(table)).toBeUndefined();
    expect(dialect.resolveTableResource(table)).toEqual({
      mode: 'sparql',
      endpoint: 'https://example.com/alice/.data/chat/-/sparql',
    });
  });

  it('resolves an absolute binding without touching the shared table endpoint', () => {
    const table = createTable();
    const dialect = new PodDialect({
      session: createSession(),
      sparqlEndpoint: 'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
    });

    expect(dialect.resolveBoundSelectEndpoint(table)).toBe(
      'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
    );
    expect(table.getSparqlEndpoint()).toBe('https://example.com/alice/.data/chat/-/sparql');
  });

  it('resolves a Pod-relative binding for room-scoped routes', () => {
    const dialect = new PodDialect({
      session: createSession(),
      podUrl: 'https://example.com/alice/',
      sparqlEndpoint: '/.data/chat/matrix-abc/-/sparql',
    });

    expect(dialect.resolveBoundSelectEndpoint(createTable())).toBe(
      'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
    );
  });

  it('supports a resolver that declines individual tables', () => {
    const resolver = vi.fn((table: PodTable) =>
      table.config.name === 'chat' ? 'https://example.com/room/-/sparql' : undefined,
    );
    const dialect = new PodDialect({ session: createSession(), sparqlEndpoint: resolver });
    const other = podTable('other', {
      id: string('id').primaryKey(),
    }, {
      base: 'https://example.com/alice/.data/other/',
      type: 'https://schema.org/Thing',
      sparqlEndpoint: 'https://example.com/alice/.data/other/-/sparql',
    });

    expect(dialect.resolveBoundSelectEndpoint(createTable())).toBe('https://example.com/room/-/sparql');
    expect(dialect.resolveBoundSelectEndpoint(other)).toBeUndefined();
    expect(other.getSparqlEndpoint()).toBe('https://example.com/alice/.data/other/-/sparql');
  });

  it('fails closed on an empty or non-http binding instead of falling back', () => {
    const emptyDialect = new PodDialect({ session: createSession(), sparqlEndpoint: '   ' });
    const badSchemeDialect = new PodDialect({
      session: createSession(),
      sparqlEndpoint: 'ftp://example.com/sparql',
    });

    expect(() => emptyDialect.resolveBoundSelectEndpoint(createTable()))
      .toThrow(/Invalid sparqlEndpoint binding/);
    expect(() => badSchemeDialect.resolveBoundSelectEndpoint(createTable()))
      .toThrow(/Invalid sparqlEndpoint binding/);
  });
});

function createExecutorDeps(boundEndpoint?: (table: PodTable) => string | undefined) {
  const sparqlStrategy = {
    mode: 'sparql' as const,
    executeSelect: vi.fn().mockResolvedValue([]),
  };
  const ldpStrategy = {
    mode: 'ldp' as const,
    executeSelect: vi.fn().mockResolvedValue([]),
  };

  const deps = {
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    ensureTableResourcePath: vi.fn().mockResolvedValue(undefined),
    resolveTableResource: vi.fn().mockReturnValue({
      mode: 'sparql',
      endpoint: 'https://example.com/alice/.data/chat/-/sparql',
    }),
    resolveBoundSelectEndpoint: boundEndpoint,
    resolveTableUrls: vi.fn().mockReturnValue({
      containerUrl: 'https://example.com/alice/.data/chat/',
      resourceUrl: 'https://example.com/alice/.data/chat/chat.ttl',
    }),
    normalizeResourceUrl: vi.fn((value: string) => value),
    normalizeContainerKey: vi.fn((value: string) => value),
    normalizeResourceKey: vi.fn((value: string) => value),
    ensureContainerExists: vi.fn(),
    ensureResourceExists: vi.fn(),
    shouldSkipResourcePreparation: vi.fn(() => true),
    shouldUseWriteTimeResourcePreparation: vi.fn(() => true),
    shouldContinueAfterResourcePreparationError: vi.fn(() => false),
    ensureIdentifierCondition: vi.fn(),
    resourceExists: vi.fn(),
    getStrategy: vi.fn(() => sparqlStrategy),
    getLdpStrategy: vi.fn(() => ldpStrategy),
    preparedContainers: new Set<string>(),
    preparedResources: new Set<string>(),
    sparqlConverter: { generateSubjectUri: vi.fn(() => 'https://example.com/alice/.data/chat/chat.ttl#a') },
    sparqlExecutor: { executeQueryWithSource: vi.fn(), invalidateHttpCache: vi.fn() },
    isSelectPlan: vi.fn(() => false),
    isInsertPlan: vi.fn(() => false),
    isUpdatePlan: vi.fn(() => false),
    isDeletePlan: vi.fn(() => false),
  } as any;
  deps.getSparqlStrategy = vi.fn(() => sparqlStrategy);

  return { deps, sparqlStrategy, ldpStrategy };
}

describe('PodExecutor per-database SELECT binding', () => {
  it('sends collection SELECT to the bound endpoint with the SPARQL strategy', async () => {
    const table = createTable();
    const { deps, sparqlStrategy, ldpStrategy } = createExecutorDeps(
      () => 'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
    );

    await new PodExecutor(deps).query({ type: 'select', table });

    expect(deps.getSparqlStrategy).toHaveBeenCalled();
    expect(deps.getStrategy).not.toHaveBeenCalled();
    expect(ldpStrategy.executeSelect).not.toHaveBeenCalled();
    expect(sparqlStrategy.executeSelect).toHaveBeenCalledWith(
      expect.objectContaining({ baseTable: table }),
      'https://example.com/alice/.data/chat/',
      'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
      { boundEndpoint: 'https://example.com/alice/.data/chat/matrix-abc/-/sparql' },
    );
  });

  it('uses SPARQL strategy even when the shared table has no endpoint', async () => {
    const table = podTable('chat', {
      id: string('id').primaryKey(),
    }, {
      base: 'https://example.com/alice/.data/chat/',
      type: 'https://schema.org/Thing',
    });
    const { deps, sparqlStrategy } = createExecutorDeps(
      () => 'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
    );
    deps.resolveTableResource.mockReturnValue({
      mode: 'ldp',
      containerUrl: 'https://example.com/alice/.data/chat/',
      resourceUrl: 'https://example.com/alice/.data/chat/chat.ttl',
    });

    await new PodExecutor(deps).query({ type: 'select', table });

    expect(sparqlStrategy.executeSelect).toHaveBeenCalledWith(
      expect.any(Object),
      'https://example.com/alice/.data/chat/',
      'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
      expect.objectContaining({ boundEndpoint: 'https://example.com/alice/.data/chat/matrix-abc/-/sparql' }),
    );
  });

  it('keeps exact-by-IRI reads on the concrete document', async () => {
    const table = createTable();
    const { deps, sparqlStrategy } = createExecutorDeps(
      () => 'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
    );

    await new PodExecutor(deps).query({
      type: 'select',
      table,
      where: { '@id': 'https://example.com/alice/.data/chat/matrix-abc/index.ttl#this' },
    });

    // Exact target: the concrete document is carried explicitly and the
    // collection binding is NOT applied.
    expect(sparqlStrategy.executeSelect).toHaveBeenCalledWith(
      expect.any(Object),
      'https://example.com/alice/.data/chat/',
      'https://example.com/alice/.data/chat/matrix-abc/index.ttl',
      { exactResource: 'https://example.com/alice/.data/chat/matrix-abc/index.ttl' },
    );
    const options = sparqlStrategy.executeSelect.mock.calls[0][3];
    expect(options).not.toHaveProperty('boundEndpoint');
  });

  it('does not bind writes: INSERT keeps the LDP strategy and resource target', async () => {
    const table = createTable();
    const { deps, ldpStrategy, sparqlStrategy } = createExecutorDeps(
      () => 'https://example.com/alice/.data/chat/matrix-abc/-/sparql',
    );
    ldpStrategy.executeInsert = vi.fn().mockResolvedValue([{ success: true, source: 'x', status: 200 }]) as never;

    await new PodExecutor(deps).query({ type: 'insert', table, values: { id: 'a', title: 'A' } });

    expect(deps.getLdpStrategy).toHaveBeenCalled();
    expect(sparqlStrategy.executeSelect).not.toHaveBeenCalled();
    expect((ldpStrategy as any).executeInsert).toHaveBeenCalledWith(
      expect.any(Object),
      'https://example.com/alice/.data/chat/',
      'https://example.com/alice/.data/chat/chat.ttl',
    );
  });

  it('keeps two concurrent databases isolated on the same shared table', async () => {
    const table = createTable();
    const roomA = createExecutorDeps(() => 'https://example.com/alice/.data/chat/room-a/-/sparql');
    const roomB = createExecutorDeps(() => 'https://example.com/alice/.data/chat/room-b/-/sparql');

    await Promise.all([
      new PodExecutor(roomA.deps).query({ type: 'select', table }),
      new PodExecutor(roomB.deps).query({ type: 'select', table }),
    ]);

    expect(roomA.sparqlStrategy.executeSelect.mock.calls[0][2])
      .toBe('https://example.com/alice/.data/chat/room-a/-/sparql');
    expect(roomB.sparqlStrategy.executeSelect.mock.calls[0][2])
      .toBe('https://example.com/alice/.data/chat/room-b/-/sparql');
    expect(table.getSparqlEndpoint()).toBe('https://example.com/alice/.data/chat/-/sparql');
  });

  it('surfaces a denied bound endpoint without retrying the broader table endpoint', async () => {
    const table = createTable();
    const { deps, sparqlStrategy } = createExecutorDeps(
      () => 'https://example.com/alice/.data/chat/room-denied/-/sparql',
    );
    sparqlStrategy.executeSelect.mockRejectedValue(
      new Error('SPARQL endpoint returned HTTP 403'),
    );

    await expect(
      new PodExecutor(deps).query({ type: 'select', table }),
    ).rejects.toThrow(/HTTP 403/);

    expect(sparqlStrategy.executeSelect).toHaveBeenCalledTimes(1);
    expect(sparqlStrategy.executeSelect.mock.calls[0][2])
      .toBe('https://example.com/alice/.data/chat/room-denied/-/sparql');
    expect(table.getSparqlEndpoint()).toBe('https://example.com/alice/.data/chat/-/sparql');
  });

  it('lets discovery proceed for tables the resolver declines (undefined keeps old behavior)', async () => {
    const table = podTable('unbound_chat', {
      id: string('id').primaryKey(),
    }, {
      base: 'https://example.com/alice/.data/unbound/',
      type: 'https://schema.org/Thing',
      typeIndex: 'private',
    });
    const resolver = vi.fn(() => undefined);
    const dialect = new PodDialect({
      session: createSession(),
      sparqlEndpoint: resolver,
    });

    // Declines this table => no binding, so discovery may still mutate the
    // table's own endpoint exactly as before.
    expect(dialect.resolveBoundSelectEndpoint(table)).toBeUndefined();
    const optionsProbe = vi.fn().mockResolvedValue({ ok: true } as Response);
    (dialect as any).runtime.getFetch = () => optionsProbe;
    (dialect as any).discovery.discover = vi.fn().mockResolvedValue([
      { container: 'https://example.com/alice/.data/unbound/' },
    ]);

    await (dialect as any).ensureTableResourcePath(table);

    expect(resolver).toHaveBeenCalledWith(table);
    expect(optionsProbe).toHaveBeenCalledWith(
      'https://example.com/alice/.data/unbound/-/sparql',
      { method: 'OPTIONS' },
    );
    expect(table.getSparqlEndpoint()).toBe('https://example.com/alice/.data/unbound/-/sparql');
  });

  it('skips endpoint discovery for tables the resolver actually binds (no global mutation)', async () => {
    const table = podTable('bound_chat', {
      id: string('id').primaryKey(),
    }, {
      base: 'https://example.com/alice/.data/bound/',
      type: 'https://schema.org/Thing',
      typeIndex: 'private',
    });
    const dialect = new PodDialect({
      session: createSession(),
      sparqlEndpoint: () => 'https://example.com/alice/.data/room-x/-/sparql',
    });

    const optionsProbe = vi.fn().mockResolvedValue({ ok: true } as Response);
    (dialect as any).runtime.getFetch = () => optionsProbe;
    (dialect as any).discovery.discover = vi.fn().mockResolvedValue([
      { container: 'https://example.com/alice/.data/bound/' },
    ]);

    await (dialect as any).ensureTableResourcePath(table);

    expect(optionsProbe).not.toHaveBeenCalled();
    expect(table.getSparqlEndpoint()).toBeUndefined();
  });
});
