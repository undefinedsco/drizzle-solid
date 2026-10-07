import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';
import { startNoAuthXpodRuntime } from './xpod-runtime';

it('actual runtime stop completes before its owned socket directory is removed', async() => {
  const runtime = await startNoAuthXpodRuntime();
  const socket = runtime.sockets?.gateway;
  try {
    expect(socket).toBeDefined();
    if (!socket) throw new Error('Owned socket transport missing');
    expect(existsSync(socket)).toBe(true);
    expect((await runtime.fetch(`${runtime.baseUrl}.well-known/openid-configuration`)).ok).toBe(true);
  } finally { await runtime.stop(); }
  if (!socket) throw new Error('Owned socket transport missing');
  expect(existsSync(socket)).toBe(false);
  expect(existsSync(dirname(socket))).toBe(false);
}, 120000);
