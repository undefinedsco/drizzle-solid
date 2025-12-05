import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';
import { resolvePodBase } from '@src/core/utils/pod-root';

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

export async function createSecondSessionInstance(): Promise<Session> {
  bootstrapEnv();

  const clientId = process.env.SOLID_CLIENT_ID_2;
  const clientSecret = process.env.SOLID_CLIENT_SECRET_2;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER;
  
  if (!clientId || !clientSecret || !oidcIssuer) {
    throw new Error('Missing SOLID_CLIENT_ID_2, SOLID_CLIENT_SECRET_2, or SOLID_OIDC_ISSUER in environment for dual-user tests');
  }

  const session = new Session();
  await session.login({
    clientId,
    clientSecret,
    oidcIssuer,
    tokenType: 'DPoP'
  });

  console.log('   ✅ 第二用户 Session创建成功');
  console.log(`   🆔 Session WebID: ${session.info.webId || 'N/A'}`);

  return session;
}

export async function grantAccess(
  ownerSession: Session,
  resourceUrl: string,
  agentWebId: string,
  modes: ('Read' | 'Write' | 'Append' | 'Control')[] = ['Read']
) {
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
    // ACP format - Access Control Policies
    const acpBody = `
      @prefix acl: <http://www.w3.org/ns/auth/acl#>.
      @prefix acp: <http://www.w3.org/ns/solid/acp#>.

      <#policy>
        a acp:AccessControlResource;
        acp:resource <${resourceUrl}>;
        acp:accessControl <#ownerRule>, <#grantRule>.

      <#ownerRule>
        a acp:AccessControl;
        acp:apply [
          a acp:Policy;
          acp:allow acl:Read, acl:Write, acl:Control;
          acp:anyOf [
            a acp:Matcher;
            acp:agent <${ownerSession.info.webId}>
          ]
        ].

      <#grantRule>
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

  const podBase = process.env.SOLID_TEST_POD_BASE || derivePodBaseFromWebId(webId);
  const containerUrl = normalizeContainerUrl(podBase, containerPath);
  const fetchFn = session.fetch.bind(session);

  const headResponse = await headResource(fetchFn, containerUrl);

  if (headResponse.status === 404 || headResponse.status >= 500) {
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

  // Always ensure ACL grants current webId control
  const aclUrl = `${containerUrl}.acl`;
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

  return containerUrl;
}
