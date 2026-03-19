import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';
import { resolvePodBase } from '@src/core/utils/pod-root';
import { buildTestPodUrl, createNoAuthPodSession, getSharedNoAuthXpodRuntime, isInProcessXpodEnabled, stopSharedNoAuthXpodRuntime } from './xpod-runtime';

type FetchLike = typeof fetch;

let sharedSessionPromise: Promise<Session> | null = null;
const HELPERS_ENV_STATE_KEY = Symbol.for('drizzle-solid.tests.helpers-env-state');

function bootstrapEnv(): void {
  const globalState = globalThis as typeof globalThis & {
    [HELPERS_ENV_STATE_KEY]?: boolean;
  };

  if (globalState[HELPERS_ENV_STATE_KEY]) {
    return;
  }

  loadEnv({ override: false, quiet: true });
  loadEnv({ path: '.env.local', override: true, quiet: true });
  globalState[HELPERS_ENV_STATE_KEY] = true;
}

export function getSessionPodBase(session: Pick<Session, 'info'> | { info?: { webId?: string } }): string {
  const webId = session.info?.webId;
  if (!webId) {
    throw new Error('Session is missing webId information');
  }

  return resolvePodBase({ webId });
}

export { buildTestPodUrl };

async function createSessionInstance(): Promise<Session> {
  bootstrapEnv();

  if (isInProcessXpodEnabled()) {
    const runtime = await getSharedNoAuthXpodRuntime();
    return await createNoAuthPodSession(runtime, 'test') as unknown as Session;
  }

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

async function createSessionInstanceWithRetry(attempts = 5, delayMs = 2000): Promise<Session> {
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
  if (isInProcessXpodEnabled()) {
    sharedSessionPromise = null;
    await stopSharedNoAuthXpodRuntime();
    return;
  }

  if (!sharedSessionPromise) {
    return;
  }
  try {
    const session = await sharedSessionPromise;
    await session.logout?.().catch(() => undefined);
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

bootstrapEnv();

// 预热全局会话，确保多套件复用同一 session
// 仅在显式启用真实集成测试且走远程 Solid 服务时提前触发
if (process.env.SOLID_ENABLE_REAL_TESTS === 'true' && !isInProcessXpodEnabled()) {
  void getSharedSession().catch(() => {
    /* noop:失败时由首次调用重新尝试并抛错 */
  });
}

/**
 * 为指定用户生成 Client Credentials Token
 * 适用于 CSS 环境
 */
async function generateTokenForUser(email: string, password: string): Promise<{ id: string; secret: string }> {
  const baseUrl = process.env.SOLID_SERVER_BASE_URL || 'http://localhost:3000';
  const response = await fetch(`${baseUrl}/idp/credentials/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `test-token-${Date.now()}`,
      email,
      password
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to generate token for ${email}: ${response.status} ${text}`);
  }

  const data = await response.json();
  return { id: data.id, secret: data.secret };
}

export async function createSecondSessionInstance(): Promise<Session> {
  bootstrapEnv();

  if (isInProcessXpodEnabled()) {
    const runtime = await getSharedNoAuthXpodRuntime();
    return await createNoAuthPodSession(runtime, 'bob') as unknown as Session;
  }

  let clientId = process.env.SOLID_CLIENT_ID_2;
  let clientSecret = process.env.SOLID_CLIENT_SECRET_2;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER || 'http://localhost:3000/';
  
  // 如果环境变量未配置，尝试为 Bob 动态生成 Token
  if (!clientId || !clientSecret) {
    console.log('   ⚠️ SOLID_CLIENT_ID_2 未配置，尝试为 Bob 动态生成凭证...');
    try {
      const creds = await generateTokenForUser('bob@example.com', 'bob123');
      clientId = creds.id;
      clientSecret = creds.secret;
      console.log('   ✅ Bob 凭证生成成功');
    } catch (e) {
      console.warn('   ❌ 无法生成 Bob 凭证:', e);
      throw new Error('Missing SOLID_CLIENT_ID_2 and failed to auto-generate for bob@example.com');
    }
  }

  const session = new Session();
  await session.login({
    clientId,
    clientSecret,
    oidcIssuer,
    tokenType: 'DPoP'
  });

  console.log('   ✅ 第二用户 (Bob) Session创建成功');
  console.log(`   🆔 Session WebID: ${session.info.webId || 'N/A'}`);

  return session;
}

export async function grantAccess(
  ownerSession: Session,
  resourceUrl: string,
  agentWebId: string,
  modes: ('Read' | 'Write' | 'Append' | 'Control')[] = ['Read']
) {
  if (isInProcessXpodEnabled()) {
    console.log(`[grantAccess] skipped in xpod allow-all mode: ${agentWebId} -> ${resourceUrl} (${modes.join(', ')})`);
    return;
  }
  // Discover ACL URL from Link header (works for both WAC and ACP)
  const headRes = await ownerSession.fetch(resourceUrl, { method: 'HEAD' });
  const linkHeader = headRes.headers.get('link') || '';

  // Parse Link header to find rel="acl"
  const aclMatch = linkHeader.match(/<([^>]+)>;\s*rel="acl"/);
  let aclUrl: string;

  if (aclMatch) {
    aclUrl = aclMatch[1];
    // If relative URL, resolve against resource URL
    if (!aclUrl.startsWith('http')) {
      const base = new URL(resourceUrl);
      aclUrl = new URL(aclMatch[1], base).toString();
    }
  } else {
    // Fallback to .acl suffix for WAC
    aclUrl = `${resourceUrl}.acl`;
  }

  console.log(`  ACL URL discovered: ${aclUrl}`);

  // Check if this is ACP (.acr) or WAC (.acl)
  const isACP = aclUrl.endsWith('.acr');

  if (isACP) {
    // ACP format - Access Control Policies (CSS 7.x format)
    // For containers: use <./> and add memberAccessControl
    // For files: use <./filename> (relative path to the file)
    const isContainer = resourceUrl.endsWith('/');
    
    // Determine the resource reference
    let resourceRef: string;
    if (isContainer) {
      resourceRef = '<./>';
    } else {
      // For files, extract filename from URL
      const urlObj = new URL(resourceUrl);
      const pathParts = urlObj.pathname.split('/');
      const filename = pathParts[pathParts.length - 1];
      resourceRef = `<./${filename}>`;
    }
    
    // Build the ACR body - handle the trailing punctuation correctly
    const acpBody = isContainer ? `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix acp: <http://www.w3.org/ns/solid/acp#>.

<#root>
    a acp:AccessControlResource;
    acp:resource ${resourceRef};
    acp:accessControl <#ownerAccess>, <#grantAccess>;
    acp:memberAccessControl <#ownerAccess>, <#grantAccess>.

<#ownerAccess>
    a acp:AccessControl;
    acp:apply [
        a acp:Policy;
        acp:allow acl:Read, acl:Write, acl:Control;
        acp:anyOf [
            a acp:Matcher;
            acp:agent <${ownerSession.info.webId}>
        ]
    ].

<#grantAccess>
    a acp:AccessControl;
    acp:apply [
        a acp:Policy;
        acp:allow ${modes.map(m => `acl:${m}`).join(', ')};
        acp:anyOf [
            a acp:Matcher;
            acp:agent <${agentWebId}>
        ]
    ].
` : `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix acp: <http://www.w3.org/ns/solid/acp#>.

<#root>
    a acp:AccessControlResource;
    acp:resource ${resourceRef};
    acp:accessControl <#ownerAccess>, <#grantAccess>.

<#ownerAccess>
    a acp:AccessControl;
    acp:apply [
        a acp:Policy;
        acp:allow acl:Read, acl:Write, acl:Control;
        acp:anyOf [
            a acp:Matcher;
            acp:agent <${ownerSession.info.webId}>
        ]
    ].

<#grantAccess>
    a acp:AccessControl;
    acp:apply [
        a acp:Policy;
        acp:allow ${modes.map(m => `acl:${m}`).join(', ')};
        acp:anyOf [
            a acp:Matcher;
            acp:agent <${agentWebId}>
        ]
    ].
`;

    const response = await ownerSession.fetch(aclUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: acpBody
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Failed to grant access via ACP on ${aclUrl}: ${response.status} ${response.statusText} - ${text}`);
    }
  } else {
    // WAC format - Web Access Control
    const modeString = modes.map(m => `<http://www.w3.org/ns/auth/acl#${m}>`).join(', ');

    const aclBody = `
      @prefix acl: <http://www.w3.org/ns/auth/acl#>.

      # Owner access (Keep owner access!)
      <#owner>
        a acl:Authorization;
        acl:agent <${ownerSession.info.webId}>;
        acl:accessTo <${resourceUrl}>;
        acl:default <${resourceUrl}>;
        acl:mode acl:Read, acl:Write, acl:Control.

      # Grant for Agent
      <#grant>
        a acl:Authorization;
        acl:agent <${agentWebId}>;
        acl:accessTo <${resourceUrl}>;
        acl:default <${resourceUrl}>;
        acl:mode ${modeString}.
    `;

    const response = await ownerSession.fetch(aclUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: aclBody
    });

    if (!response.ok) {
      throw new Error(`Failed to grant access via WAC on ${aclUrl}: ${response.status} ${response.statusText}`);
    }
  }
}

function derivePodBaseFromWebId(webId: string): string {
  // legacy helper now delegates to shared resolver
  return resolvePodBase({ webId });
}

function normalizeContainerUrl(baseUrl: string, containerPath: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
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

async function headResource(fetchFn: FetchLike, url: string): Promise<Response> {
  return await fetchFn(url, { method: 'HEAD' });
}

export async function ensureContainer(session: Session, containerPath: string): Promise<string> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error('Session is missing webId information');
  }

  const podBase = isInProcessXpodEnabled()
    ? derivePodBaseFromWebId(webId)
    : process.env.SOLID_TEST_POD_BASE || derivePodBaseFromWebId(webId);
  const containerUrl = normalizeContainerUrl(podBase, containerPath);
  const fetchFn = session.fetch.bind(session);

  const headResponse = await headResource(fetchFn, containerUrl);

  // Handle 401 as "container might not exist" - try to create it
  // Also handle 404 and 5xx as before
  if (headResponse.status === 404 || headResponse.status === 401 || headResponse.status >= 500) {
    let createResponse: Response | null = null;
    let lastError: unknown;
    
    // Retry loop for creation - increased retries for stability
    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetchFn(containerUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/turtle',
            'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
          }
        });
        
        if (response.ok || response.status === 409 || response.status === 201 || response.status === 200) {
          createResponse = response;
          break;
        }
        
        if (response.status >= 500) {
           console.warn(`[ensureContainer] Attempt ${i + 1}/${maxRetries} failed with ${response.status}, retrying...`);
           await new Promise(r => setTimeout(r, 2000));
           createResponse = response; // Keep last response
           continue;
        }
        
        createResponse = response;
        throw new Error(`Failed to create container ${containerUrl}: ${response.status} ${response.statusText}`);
      } catch (e) {
        lastError = e;
        console.warn(`[ensureContainer] Attempt ${i + 1}/${maxRetries} failed with error:`, e);
        if (i < maxRetries - 1) await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!createResponse && lastError) {
        // Re-throw last error if we failed all retries and didn't get a response object to check
        throw lastError;
    }
    
    if (createResponse && !createResponse.ok && createResponse.status !== 409 && createResponse.status !== 201 && createResponse.status !== 200) {
        // Double check if it exists now despite error
        try {
           const check = await headResource(fetchFn, containerUrl);
           if (check.ok || check.status === 409) {
             console.log(`[ensureContainer] Container ${containerUrl} exists after failed creation attempt.`);
           } else {
             throw new Error(`Failed to create container ${containerUrl}: ${createResponse.status} ${createResponse.statusText}`);
           }
        } catch (e) {
           throw new Error(`Failed to create container ${containerUrl}: ${createResponse.status} ${createResponse.statusText}`);
        }
    }

  } else if (!headResponse.ok && headResponse.status !== 409) {
    throw new Error(`Failed to access container ${containerUrl}: ${headResponse.status} ${headResponse.statusText}`);
  }

  if (isInProcessXpodEnabled()) {
    return containerUrl;
  }

  // Discover ACL URL from Link header to determine if ACP or WAC
  const checkHead = await headResource(fetchFn, containerUrl);
  const linkHeader = checkHead.headers.get('link') || '';
  const aclMatch = linkHeader.match(/<([^>]+)>;\s*rel="acl"/);
  
  let aclUrl: string;
  let isACP = false;
  
  if (aclMatch) {
    aclUrl = aclMatch[1];
    if (!aclUrl.startsWith('http')) {
      aclUrl = new URL(aclMatch[1], containerUrl).toString();
    }
    isACP = aclUrl.endsWith('.acr');
  } else {
    aclUrl = `${containerUrl}.acl`;
  }

  // Ensure ACL grants current webId control
  if (isACP) {
    // ACP format
    const acpBody = `
@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix acp: <http://www.w3.org/ns/solid/acp#>.

<#root>
    a acp:AccessControlResource;
    acp:resource <./>;
    acp:accessControl <#ownerAccess>;
    acp:memberAccessControl <#ownerAccess>.

<#ownerAccess>
    a acp:AccessControl;
    acp:apply [
        a acp:Policy;
        acp:allow acl:Read, acl:Write, acl:Control;
        acp:anyOf [
            a acp:Matcher;
            acp:agent <${webId}>
        ]
    ].
`;
    await fetchFn(aclUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: acpBody
    });
  } else {
    // WAC format
    const aclBody = `<#owner>
    a <http://www.w3.org/ns/auth/acl#Authorization>;
    <http://www.w3.org/ns/auth/acl#agent> <${webId}>;
    <http://www.w3.org/ns/auth/acl#accessTo> <${containerUrl}>;
    <http://www.w3.org/ns/auth/acl#default> <${containerUrl}>;
    <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Read>, <http://www.w3.org/ns/auth/acl#Write>, <http://www.w3.org/ns/auth/acl#Control>, <http://www.w3.org/ns/auth/acl#Append>.`;

    await fetchFn(aclUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: aclBody
    });
  }

  return containerUrl;
}
