import { afterEach, describe, expect, it, vi } from 'vitest';

type RuntimeHandle = {
  baseUrl: string;
  fetch: typeof fetch;
  stop: () => Promise<void>;
};

const fakeRuntime: RuntimeHandle = {
  baseUrl: 'http://localhost/',
  fetch: vi.fn<typeof fetch>(),
  stop: vi.fn(async () => undefined),
};

async function importRuntimeHelper(startXpodRuntime: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock('@undefineds.co/xpod/runtime', () => ({
    startXpodRuntime,
  }));

  return await import('../../integration/css/xpod-runtime');
}

describe('xpod runtime test helper', () => {
  afterEach(async () => {
    try {
      const runtimeHelper = await import('../../integration/css/xpod-runtime');
      await runtimeHelper.stopSharedNoAuthXpodRuntime();
    } catch {
      // noop
    }

    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock('@undefineds.co/xpod/runtime');
    vi.resetModules();
  });

  it('delegates port selection to xpod unless runtime ports are explicitly configured', async () => {
    const startXpodRuntime = vi.fn().mockResolvedValue(fakeRuntime);
    const { startNoAuthXpodRuntime } = await importRuntimeHelper(startXpodRuntime);

    await startNoAuthXpodRuntime();

    expect(startXpodRuntime).toHaveBeenCalledTimes(1);
    expect(startXpodRuntime.mock.calls[0]?.[0]).not.toHaveProperty('gatewayPort');
    expect(startXpodRuntime.mock.calls[0]?.[0]).not.toHaveProperty('cssPort');
    expect(startXpodRuntime.mock.calls[0]?.[0]).not.toHaveProperty('apiPort');
  });

  it('passes through explicit runtime ports when configured', async () => {
    vi.stubEnv('XPOD_RUNTIME_GATEWAY_PORT', '5601');
    vi.stubEnv('XPOD_RUNTIME_CSS_PORT', '5602');
    vi.stubEnv('XPOD_RUNTIME_API_PORT', '5603');

    const startXpodRuntime = vi.fn().mockResolvedValue(fakeRuntime);
    const { startNoAuthXpodRuntime } = await importRuntimeHelper(startXpodRuntime);

    await startNoAuthXpodRuntime();

    expect(startXpodRuntime).toHaveBeenCalledWith(expect.objectContaining({
      gatewayPort: 5601,
      cssPort: 5602,
      apiPort: 5603,
    }));
  });

  it('retries transient EADDRINUSE failures when runtime ports are not pinned', async () => {
    const startXpodRuntime = vi
      .fn()
      .mockRejectedValueOnce(new Error('listen EADDRINUSE: address already in use :::57079'))
      .mockResolvedValue(fakeRuntime);

    const { startNoAuthXpodRuntime } = await importRuntimeHelper(startXpodRuntime);

    await expect(startNoAuthXpodRuntime()).resolves.toBe(fakeRuntime);
    expect(startXpodRuntime).toHaveBeenCalledTimes(2);
  });

  it('reuses the shared runtime across module reloads until explicitly stopped', async () => {
    const startXpodRuntime = vi.fn().mockResolvedValue(fakeRuntime);

    const helperA = await importRuntimeHelper(startXpodRuntime);
    await helperA.getSharedNoAuthXpodRuntime();

    vi.resetModules();
    const helperB = await import('../../integration/css/xpod-runtime');
    await helperB.getSharedNoAuthXpodRuntime();

    expect(startXpodRuntime).toHaveBeenCalledTimes(1);

    await helperB.stopSharedNoAuthXpodRuntime();
    expect(fakeRuntime.stop).toHaveBeenCalledTimes(1);
  });
});
