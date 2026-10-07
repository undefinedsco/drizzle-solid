import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StrictIfMatchN3Backend } from '../../../src';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';

const folder = `/conditional-qualify-${Date.now()}/`;
const base = buildTestPodUrl(folder);

/**
 * Root acceptance: after the authority document-version fix the real
 * `StrictIfMatchN3Backend.qualify` probe must succeed on the actual target
 * (consecutive immediate mutations must each change the version, stale/forged
 * versions must be rejected, and DELETE must enforce the stale version).
 */
describe('StrictIfMatchN3Backend.qualify on the authority document version', () => {
  let session: Awaited<ReturnType<typeof createTestSession>>;
  beforeAll(async () => { session = await createTestSession(); await ensureContainer(session, folder); }, 120000);
  afterAll(async () => { /* shared runtime stopped by sibling suites */ });

  it('qualifies a fresh owned probe against the real target', async () => {
    const probeDocument = `${base}owned-probe-${Date.now()}.ttl`;
    const backend = await StrictIfMatchN3Backend.qualify({ fetch: session.fetch, scope: base, probeDocument });
    expect(backend).toBeInstanceOf(StrictIfMatchN3Backend);
    // Qualify owns cleanup of its probe; the scope must not retain it.
    const leftover = await session.fetch(probeDocument, { redirect: 'error' });
    expect(leftover.status).toBe(404);
    await leftover.text();
  }, 90000);
});
