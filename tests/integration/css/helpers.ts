import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';

type FetchLike = typeof fetch;

let envBootstrapped = false;
let sharedSessionPromise: Promise<Session> | null = null;

function bootstrapEnv(): void {
  if (envBootstrapped) return;
  loadEnv({ path: '.env.local', override: false });
  loadEnv();
  envBootstrapped = true;
}

async function createSessionInstance(): Promise<Session> {
  bootstrapEnv();

  const clientId = process.env.SOLID_CLIENT_ID;
  const clientSecret = process.env.SOLID_CLIENT_SECRET;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER;
  
  if (!clientId || !clientSecret || !oidcIssuer) {
    throw new Error('Missing SOLID_CLIENT_ID, SOLID_CLIENT_SECRET, or SOLID_OIDC_ISSUER in environment');
  }

  const session = new Session();
  await session.login({
    clientId,
    clientSecret,
    oidcIssuer,
    tokenType: 'DPoP'
  });

  console.log('   ✅ Session创建成功');
  console.log(`   🆔 Session WebID: ${session.info.webId || 'N/A'}`);
  console.log(`   🔐 Session已认证: ${session.info.isLoggedIn}`);

  return session;
}

async function createSessionInstanceWithRetry(attempts = 3, delayMs = 2000): Promise<Session> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await createSessionInstance();
    } catch (error) {
      lastError = error;
      const attempt = i + 1;
      console.warn(`[session] login attempt ${attempt}/${attempts} failed:`, error instanceof Error ? error.message : error);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function getSharedSession(): Promise<Session> {
  if (!sharedSessionPromise) {
    sharedSessionPromise = createSessionInstanceWithRetry().catch((error) => {
      sharedSessionPromise = null;
      throw error;
    });
  }
  return await sharedSessionPromise;
}

export async function resetSharedSession(): Promise<void> {
  if (!sharedSessionPromise) {
    return;
  }
  try {
    const session = await sharedSessionPromise;
    await session.logout().catch(() => undefined);
  } finally {
    sharedSessionPromise = null;
  }
}

export async function createTestSession(options?: { shared?: boolean; skipTypeIndex?: boolean }): Promise<Session> {
  const useShared = options?.shared !== false;
  if (useShared) {
    return await getSharedSession();
  }
  return await createSessionInstanceWithRetry();
}

// 预热全局会话，确保多套件复用同一 session
// 仅在启用真实集成测试时提前触发
if (process.env.SOLID_ENABLE_REAL_TESTS !== 'false') {
  void getSharedSession().catch(() => {
    /* noop:失败时由首次调用重新尝试并抛错 */
  });
}

function derivePodBaseFromWebId(webId: string): string {
  const url = new URL(webId);
  url.hash = '';
  const segments = url.pathname.split('/').filter(Boolean);
  const podSegment = segments[0] ? `${segments[0]}/` : '';
  url.pathname = `/${podSegment}`;
  return url.toString();
}

function normalizeContainerUrl(baseUrl: string, containerPath: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = containerPath.replace(/^\/+/, '');
  const url = new URL(normalizedPath, normalizedBase);
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}

async function headResource(fetchFn: FetchLike, url: string): Promise<Response> {
  return await fetchFn(url, { method: 'HEAD' });
}

export async function ensureContainer(session: Session, containerPath: string): Promise<string> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error('Session is missing webId information');
  }

  const podBase = process.env.SOLID_TEST_POD_BASE || derivePodBaseFromWebId(webId);
  const containerUrl = normalizeContainerUrl(podBase, containerPath);
  const fetchFn = session.fetch.bind(session);

  const headResponse = await headResource(fetchFn, containerUrl);

  if (headResponse.status === 404) {
    const createResponse = await fetchFn(containerUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle',
        'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
      }
    });

    if (!createResponse.ok && createResponse.status !== 409) {
      throw new Error(`Failed to create container ${containerUrl}: ${createResponse.status} ${createResponse.statusText}`);
    }
  } else if (!headResponse.ok && headResponse.status !== 409) {
    throw new Error(`Failed to access container ${containerUrl}: ${headResponse.status} ${headResponse.statusText}`);
  }

  return containerUrl;
}
