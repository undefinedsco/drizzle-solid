import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';

type FetchLike = typeof fetch;

let envBootstrapped = false;

function bootstrapEnv(): void {
  if (envBootstrapped) return;
  loadEnv({ path: '.env.local', override: false });
  loadEnv();
  envBootstrapped = true;
}

export async function createTestSession(): Promise<Session> {
  bootstrapEnv();

  // 使用真实的 alice 账户进行认证
  const session = new Session();
  
  const clientId = process.env.SOLID_CLIENT_ID;
  const clientSecret = process.env.SOLID_CLIENT_SECRET;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER || 'http://localhost:3000';
  
  if (!clientId || !clientSecret) {
    throw new Error('Missing SOLID_CLIENT_ID or SOLID_CLIENT_SECRET in .env');
  }

  try {
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
  } catch (error) {
    console.error('   ❌ Session认证失败:', error);
    throw error;
  }
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
