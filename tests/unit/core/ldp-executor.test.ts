import { describe, expect, it, vi } from 'vitest';
import { LdpExecutor } from '@src/core/execution/ldp-executor';
import { id, podTable, string } from '@src/core/schema';
import { UriResolverImpl } from '@src/core/uri';

const sessionResource = podTable('session', {
  id: id(),
  status: string('status').predicate('https://undefineds.co/ns#status'),
}, {
  base: 'https://example.com/.data/sessions/',
  type: 'https://undefineds.co/ns#Session',
  subjectTemplate: '{id}.ttl',
});

const auditResource = podTable('audit', {
  id: id(),
  action: string('action').predicate('https://undefineds.co/ns#action'),
}, {
  base: 'https://example.com/.data/audits/',
  type: 'https://undefineds.co/ns#AuditEntry',
  subjectTemplate: '{yyyy}/{MM}/{dd}.ttl#{id}',
});

function createExecutor(fetchFn: typeof fetch) {
  return new LdpExecutor(
    { invalidateHttpCache: vi.fn().mockResolvedValue(undefined) } as any,
    fetchFn,
    new UriResolverImpl('https://example.com/'),
  );
}

describe('LdpExecutor', () => {
  it('uses PATCH first for one-resource document inserts when existence probes are disabled', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;
    const executor = createExecutor(fetchFn);

    await executor.executeInsert([
      { id: 'session-1', status: 'active' },
    ], sessionResource, 'https://example.com/.data/sessions/', {
      skipResourceExistenceCheck: true,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/.data/sessions/session-1.ttl',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/sparql-update' },
      }),
    );
  });

  it('falls back to PUT for one-resource document inserts when PATCH reports a missing document', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 })) as unknown as typeof fetch;
    const executor = createExecutor(fetchFn);

    await executor.executeInsert([
      { id: 'session-1', status: 'active' },
    ], sessionResource, 'https://example.com/.data/sessions/', {
      skipResourceExistenceCheck: true,
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://example.com/.data/sessions/session-1.ttl',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/sparql-update' },
      }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      'https://example.com/.data/sessions/session-1.ttl',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'text/turtle' },
      }),
    );
  });

  it('keeps PATCH first for date-bucketed fragment inserts when existence probes are disabled', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;
    const executor = createExecutor(fetchFn);

    await executor.executeInsert([
      { id: '2026/05/14.ttl#audit-1', action: 'tool_execution_started' },
    ], auditResource, 'https://example.com/.data/audits/', {
      skipResourceExistenceCheck: true,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.com/.data/audits/2026/05/14.ttl',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/sparql-update' },
      }),
    );
  });
});
