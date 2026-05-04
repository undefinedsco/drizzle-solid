import { describe, expect, it, vi } from 'vitest';
import { PodExecutor } from '@src/core/execution/pod-executor';
import { podTable, string } from '@src/core/schema';

const table = podTable('executor_users', {
  id: string('id').primaryKey(),
  name: string('name').predicate('https://schema.org/name'),
}, {
  base: 'https://example.com/users.ttl',
  type: 'https://schema.org/Person',
});

function createDeps() {
  const ldpStrategy = {
    mode: 'ldp' as const,
    executeSelect: vi.fn().mockRejectedValue(new Error('boom')),
  };
  const sparqlStrategy = {
    mode: 'sparql' as const,
    executeSelect: vi.fn().mockRejectedValue(new Error('boom')),
  };

  return {
    ldpStrategy,
    sparqlStrategy,
    deps: {
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      ensureTableResourcePath: vi.fn().mockResolvedValue(undefined),
      resolveTableResource: vi.fn().mockReturnValue({ mode: 'sparql', endpoint: 'https://example.com/sparql' }),
      resolveTableUrls: vi.fn().mockReturnValue({
        containerUrl: 'https://example.com/',
        resourceUrl: 'https://example.com/users.ttl',
      }),
      normalizeResourceUrl: vi.fn((value: string) => value),
      normalizeContainerKey: vi.fn((value: string) => value),
      normalizeResourceKey: vi.fn((value: string) => value),
      ensureContainerExists: vi.fn(),
      ensureResourceExists: vi.fn(),
      ensureIdentifierCondition: vi.fn(),
      resourceExists: vi.fn(),
      getStrategy: vi.fn(() => sparqlStrategy),
      getLdpStrategy: vi.fn(() => ldpStrategy),
      preparedContainers: new Set<string>(),
      preparedResources: new Set<string>(),
      sparqlConverter: {},
      sparqlExecutor: {},
      isSelectPlan: vi.fn(() => false),
      isInsertPlan: vi.fn(() => false),
      isUpdatePlan: vi.fn(() => false),
      isDeletePlan: vi.fn(() => false),
    } as any,
  };
}

describe('PodExecutor', () => {
  it('does not print internal operation failures unless LINX_DEBUG=1', async () => {
    const previousDebug = process.env.LINX_DEBUG;
    delete process.env.LINX_DEBUG;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps } = createDeps();

    await expect(new PodExecutor(deps).query({
      type: 'select',
      table,
      where: { name: 'Alice' },
    })).rejects.toThrow('boom');

    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    if (previousDebug === undefined) {
      delete process.env.LINX_DEBUG;
    } else {
      process.env.LINX_DEBUG = previousDebug;
    }
  });

  it('routes exact IRI reads to the LDP document even when table has SPARQL endpoint', async () => {
    const { deps, ldpStrategy, sparqlStrategy } = createDeps();

    await expect(new PodExecutor(deps).query({
      type: 'select',
      table,
      where: { '@id': 'https://example.com/users.ttl#alice' },
    })).rejects.toThrow('boom');

    expect(ldpStrategy.executeSelect).toHaveBeenCalledWith(
      expect.any(Object),
      'https://example.com/',
      'https://example.com/users.ttl',
    );
    expect(sparqlStrategy.executeSelect).not.toHaveBeenCalled();
  });
});
