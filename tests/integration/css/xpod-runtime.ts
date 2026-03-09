import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

type RuntimeModule = {
  startXpodRuntime: (options?: Record<string, unknown>) => Promise<RuntimeHandle>;
};

export type RuntimeHandle = {
  baseUrl: string;
  fetch: typeof fetch;
  stop: () => Promise<void>;
};

export type NoAuthSession = {
  fetch: typeof fetch;
  info: {
    isLoggedIn: boolean;
    webId: string;
    clientId?: string;
    clientSecret?: string;
    oidcIssuer?: string;
  };
};

type SeedAccount = {
  email: string;
  password: string;
  podName: string;
};

type SeededPod = {
  webId: string;
  podBase: string;
  clientId?: string;
  clientSecret?: string;
  oidcIssuer: string;
};

const DEFAULT_INPROCESS_BASE_URL = 'http://localhost/';
const DEFAULT_REMOTE_SERVER_BASE_URL = 'http://localhost:5739/';
const DEFAULT_SEED_ACCOUNTS: SeedAccount[] = [
  { email: 'test@dev.local', password: 'test123456', podName: 'test' },
  { email: 'alice@dev.local', password: 'alice123456', podName: 'alice' },
  { email: 'bob@dev.local', password: 'bob123456', podName: 'bob' },
];

let sharedRuntimePromise: Promise<RuntimeHandle> | null = null;
const seededPodPromises = new Map<string, Promise<SeededPod>>();
let cachedSeedAccounts: SeedAccount[] | null = null;

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function normalizeUrl(value: string, baseUrl: string): string {
  return new URL(value, baseUrl).toString();
}

function resolveSeedConfigPath(): string | undefined {
  const candidates = [
    process.env.CSS_SEED_CONFIG,
    path.resolve(process.cwd(), '../xpod/config/seed.dev.json'),
    path.resolve(process.cwd(), '../xpod/config/seeds/test.json'),
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function loadSeedAccounts(): SeedAccount[] {
  if (cachedSeedAccounts) {
    return cachedSeedAccounts;
  }

  const configPath = resolveSeedConfigPath();
  if (!configPath) {
    cachedSeedAccounts = DEFAULT_SEED_ACCOUNTS;
    return cachedSeedAccounts;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Array<Record<string, unknown>>;
    const accounts = parsed
      .map((entry) => {
        const pods = Array.isArray(entry?.pods) ? entry.pods : [];
        const pod = pods.find((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
        const podName = typeof pod?.name === 'string' ? pod.name : undefined;
        if (typeof entry?.email !== 'string' || typeof entry?.password !== 'string' || !podName) {
          return null;
        }
        return {
          email: entry.email,
          password: entry.password,
          podName,
        } satisfies SeedAccount;
      })
      .filter((account): account is SeedAccount => Boolean(account));

    cachedSeedAccounts = accounts.length > 0 ? accounts : DEFAULT_SEED_ACCOUNTS;
    return cachedSeedAccounts;
  } catch {
    cachedSeedAccounts = DEFAULT_SEED_ACCOUNTS;
    return cachedSeedAccounts;
  }
}

function getSeedAccount(podId: string): SeedAccount {
  const normalizedPodId = podId.replace(/^\/+|\/+$/g, '');
  const account = loadSeedAccounts().find((item) => item.podName === normalizedPodId);
  if (!account) {
    throw new Error(`No seed account found for pod '${normalizedPodId}'. Available pods: ${loadSeedAccounts().map((item) => item.podName).join(', ')}`);
  }
  return account;
}

export function hasRemoteSolidCredentials(): boolean {
  return Boolean(
    process.env.SOLID_OIDC_ISSUER &&
    process.env.SOLID_CLIENT_ID &&
    process.env.SOLID_CLIENT_SECRET,
  );
}

function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return value.includes('localhost') || value.includes('127.0.0.1');
  }
}

export function shouldPreferRemoteSolidServer(): boolean {
  if (!hasRemoteSolidCredentials()) {
    return false;
  }

  return !isLoopbackUrl(process.env.SOLID_OIDC_ISSUER) && !isLoopbackUrl(process.env.SOLID_TEST_POD_BASE);
}

export function getSolidIntegrationMode(): 'disabled' | 'remote' | 'in-process' {
  if (process.env.SOLID_ENABLE_REAL_TESTS !== 'true') {
    return 'disabled';
  }

  return isInProcessXpodEnabled() ? 'in-process' : 'remote';
}

export function isInProcessXpodEnabled(): boolean {
  if (process.env.XPOD_ENABLE_INPROCESS_TESTS === 'true') {
    return true;
  }

  if (process.env.XPOD_ENABLE_INPROCESS_TESTS === 'false') {
    return false;
  }

  if (process.env.SOLID_ENABLE_REAL_TESTS !== 'true') {
    return false;
  }

  return !shouldPreferRemoteSolidServer();
}

export function getTestPodBase(podId = 'test'): string {
  const inProcess = isInProcessXpodEnabled();
  const explicitPodBase = process.env.SOLID_TEST_POD_BASE;
  if (!inProcess && explicitPodBase) {
    return ensureTrailingSlash(explicitPodBase);
  }

  const serverBase = inProcess
    ? DEFAULT_INPROCESS_BASE_URL
    : ensureTrailingSlash(process.env.SOLID_SERVER_BASE_URL || process.env.SOLID_OIDC_ISSUER || DEFAULT_REMOTE_SERVER_BASE_URL);

  return new URL(`${podId.replace(/^\/+|\/+$/g, '')}/`, serverBase).toString();
}

export function buildTestPodUrl(relativePath: string, podId = 'test'): string {
  const normalizedPath = relativePath.replace(/^\/+/, '');
  return new URL(normalizedPath, getTestPodBase(podId)).toString();
}

async function loadPublishedRuntimeModule(): Promise<RuntimeModule> {
  return await import('@undefineds.co/xpod/runtime');
}

async function loadLocalRuntimeModule(): Promise<RuntimeModule> {
  return await import('../../../../xpod/src/runtime/index.ts');
}

function getRuntimeSourcePreference(): 'package' | 'local' {
  return process.env.XPOD_RUNTIME_SOURCE === 'local' ? 'local' : 'package';
}

function resolveExplicitRuntimePort(name: 'gateway' | 'css' | 'api'): number | undefined {
  const envKey = `XPOD_RUNTIME_${name.toUpperCase()}_PORT`;
  const raw = process.env[envKey];
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envKey} value: ${raw}`);
  }

  return parsed;
}

async function allocateLoopbackPort(explicitPort?: number): Promise<number> {
  if (explicitPort) {
    return explicitPort;
  }

  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate loopback port for xpod runtime'));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function allocateRuntimePorts(): Promise<{ gatewayPort: number; cssPort: number; apiPort: number }> {
  const gatewayPort = await allocateLoopbackPort(resolveExplicitRuntimePort('gateway'));
  const cssPort = await allocateLoopbackPort(resolveExplicitRuntimePort('css'));
  const apiPort = await allocateLoopbackPort(resolveExplicitRuntimePort('api'));

  return {
    gatewayPort,
    cssPort,
    apiPort,
  };
}


export async function startNoAuthXpodRuntime(): Promise<RuntimeHandle> {
  const seedConfigPath = resolveSeedConfigPath();
  const runtimePorts = await allocateRuntimePorts();
  const options = {
    mode: 'local',
    open: true,
    transport: 'socket',
    bindHost: '127.0.0.1',
    baseUrl: DEFAULT_INPROCESS_BASE_URL,
    logLevel: 'warn',
    ...runtimePorts,
    env: seedConfigPath ? { CSS_SEED_CONFIG: seedConfigPath } : undefined,
  };

  if (getRuntimeSourcePreference() === 'local') {
    const runtimeModule = await loadLocalRuntimeModule();
    return await runtimeModule.startXpodRuntime(options);
  }

  try {
    const runtimeModule = await loadPublishedRuntimeModule();
    return await runtimeModule.startXpodRuntime(options);
  } catch (packageError) {
    throw new Error(
      `Unable to start xpod runtime from npm package. ` +
      `package error: ${String(packageError)}. ` +
      `Use XPOD_RUNTIME_SOURCE=local only for explicit local debugging.`
    );
  }
}

export async function getSharedNoAuthXpodRuntime(): Promise<RuntimeHandle> {
  if (!sharedRuntimePromise) {
    sharedRuntimePromise = startNoAuthXpodRuntime().catch((error) => {
      sharedRuntimePromise = null;
      throw error;
    });
  }
  return await sharedRuntimePromise;
}

async function stopRuntimeWithTimeout(runtime: RuntimeHandle | null, timeoutMs = 15000): Promise<void> {
  if (!runtime) {
    return;
  }

  let timedOut = false;
  await Promise.race([
    runtime.stop().catch((error) => {
      console.warn('[xpod-runtime] Failed to stop runtime cleanly:', error instanceof Error ? error.message : error);
    }),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        console.warn(`[xpod-runtime] Runtime stop exceeded ${timeoutMs}ms; continuing test teardown.`);
        resolve();
      }, timeoutMs).unref?.();
    }),
  ]);

  if (timedOut) {
    return;
  }
}

export async function stopSharedNoAuthXpodRuntime(): Promise<void> {
  if (!sharedRuntimePromise) {
    return;
  }

  const runtime = await sharedRuntimePromise.catch(() => null);
  sharedRuntimePromise = null;
  seededPodPromises.clear();
  await stopRuntimeWithTimeout(runtime);
}

async function parseJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestJson(runtime: RuntimeHandle, input: string, init?: RequestInit): Promise<any> {
  const response = await runtime.fetch(input, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${init?.method || 'GET'} ${input} failed: ${response.status} ${response.statusText} ${body}`.trim());
  }
  return await parseJson(response);
}

async function loginWithSeed(runtime: RuntimeHandle, email: string, password: string): Promise<string> {
  const baseUrl = ensureTrailingSlash(runtime.baseUrl);
  const result = await requestJson(runtime, normalizeUrl('/.account/login/password/', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const authorization = result.authorization as string | undefined;
  if (!authorization) {
    throw new Error(`Seed login succeeded without authorization token for ${email}`);
  }

  return authorization;
}

async function createAccountToken(runtime: RuntimeHandle): Promise<string> {
  const baseUrl = ensureTrailingSlash(runtime.baseUrl);
  const result = await requestJson(runtime, normalizeUrl('/.account/account/', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  });

  const authorization = result.authorization as string | undefined;
  if (!authorization) {
    throw new Error('Account bootstrap did not return an authorization token');
  }

  return authorization;
}

async function bindSeedPasswordLogin(runtime: RuntimeHandle, token: string, controls: any, email: string, password: string): Promise<void> {
  const createUrl = controls.controls?.password?.create as string | undefined;
  if (!createUrl) {
    return;
  }

  const baseUrl = ensureTrailingSlash(runtime.baseUrl);
  const response = await runtime.fetch(normalizeUrl(createUrl, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `CSS-Account-Token ${token}`,
    },
    body: JSON.stringify({ email, password }),
  });

  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => '');
  if (response.status === 409 || body.includes('already') || body.includes('exists')) {
    return;
  }

  throw new Error(`Failed to bind seed password login for ${email}: ${response.status} ${body}`);
}

async function ensureSeedPodExists(runtime: RuntimeHandle, token: string, controls: any, podName: string): Promise<void> {
  const createUrl = controls.controls?.account?.pod as string | undefined;
  if (!createUrl) {
    return;
  }

  const baseUrl = ensureTrailingSlash(runtime.baseUrl);
  const response = await runtime.fetch(normalizeUrl(createUrl, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `CSS-Account-Token ${token}`,
    },
    body: JSON.stringify({ name: podName }),
  });

  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => '');
  if (response.status === 409 || body.includes('already') || body.includes('exists')) {
    return;
  }

  throw new Error(`Failed to ensure seed pod ${podName}: ${response.status} ${body}`);
}

async function getSeedAccountToken(runtime: RuntimeHandle, account: SeedAccount): Promise<{ token: string; controls: any }> {
  try {
    const token = await loginWithSeed(runtime, account.email, account.password);
    const controls = await getAccountControls(runtime, token);
    return { token, controls };
  } catch {
    const token = await createAccountToken(runtime);
    const controls = await getAccountControls(runtime, token);
    await bindSeedPasswordLogin(runtime, token, controls, account.email, account.password);
    await ensureSeedPodExists(runtime, token, controls, account.podName);
    return { token, controls };
  }
}

async function getAccountControls(runtime: RuntimeHandle, token: string): Promise<any> {
  const baseUrl = ensureTrailingSlash(runtime.baseUrl);
  return await requestJson(runtime, normalizeUrl('/.account/', baseUrl), {
    headers: {
      Accept: 'application/json',
      Authorization: `CSS-Account-Token ${token}`,
    },
  });
}

async function createClientCredentials(runtime: RuntimeHandle, createUrl: string, token: string, webId: string): Promise<{ id: string; secret: string }> {
  const baseUrl = ensureTrailingSlash(runtime.baseUrl);
  return await requestJson(runtime, normalizeUrl(createUrl, baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `CSS-Account-Token ${token}`,
    },
    body: JSON.stringify({
      name: `drizzle-solid-${Date.now()}`,
      webId,
    }),
  });
}

async function getSeededPod(runtime: RuntimeHandle, podId: string): Promise<SeededPod> {
  const account = getSeedAccount(podId);
  const { token, controls } = await getSeedAccountToken(runtime, account);
  await ensureSeedPodExists(runtime, token, controls, account.podName);
  const clientCredentialsUrl = controls.controls?.account?.clientCredentials as string | undefined;
  if (!clientCredentialsUrl) {
    throw new Error(`Seed account ${account.email} did not expose a clientCredentials endpoint`);
  }

  const podBase = getTestPodBase(account.podName);
  const webId = `${podBase}profile/card#me`;
  const credentials = await createClientCredentials(runtime, clientCredentialsUrl, token, webId);

  return {
    webId,
    podBase,
    clientId: credentials.id,
    clientSecret: credentials.secret,
    oidcIssuer: ensureTrailingSlash(runtime.baseUrl),
  };
}

async function getSeededTestPod(runtime: RuntimeHandle, podId: string): Promise<SeededPod> {
  const key = `${runtime.baseUrl}::${podId}`;
  if (!seededPodPromises.has(key)) {
    seededPodPromises.set(key, getSeededPod(runtime, podId).catch((error) => {
      seededPodPromises.delete(key);
      throw error;
    }));
  }
  return await seededPodPromises.get(key)!;
}

function normalizeContainerUrl(baseUrl: string, containerPath: string): string {
  const normalizedBase = ensureTrailingSlash(baseUrl);
  const podId = normalizedBase.split('/').filter(Boolean).pop() ?? '';
  let normalizedPath = containerPath.replace(/^\/+/, '');
  if (podId && normalizedPath.startsWith(`${podId}/`)) {
    normalizedPath = normalizedPath.slice(podId.length + 1);
  }
  const url = new URL(normalizedPath, normalizedBase);
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}

async function ensureContainerForSession(session: NoAuthSession, containerPath: string): Promise<string> {
  const webId = session.info.webId;
  const podBase = webId.split('profile')[0];
  const containerUrl = normalizeContainerUrl(podBase, containerPath);

  const headResponse = await session.fetch(containerUrl, { method: 'HEAD' }).catch(() => null);
  if (headResponse?.ok || headResponse?.status === 409) {
    return containerUrl;
  }

  const response = await session.fetch(containerUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/turtle',
      'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    },
  });

  if (!response.ok && response.status !== 200 && response.status !== 201 && response.status !== 409) {
    throw new Error(`Failed to create container ${containerUrl}: ${response.status} ${response.statusText}`);
  }

  return containerUrl;
}

export async function createNoAuthPodSession(runtime: RuntimeHandle, podId = 'test'): Promise<NoAuthSession> {
  const seededPod = await getSeededTestPod(runtime, podId);
  const session: NoAuthSession = {
    fetch: runtime.fetch,
    info: {
      isLoggedIn: true,
      webId: seededPod.webId,
      clientId: seededPod.clientId,
      clientSecret: seededPod.clientSecret,
      oidcIssuer: seededPod.oidcIssuer,
    },
  };

  await ensureContainerForSession(session, 'profile/').catch(() => undefined);

  return session;
}
