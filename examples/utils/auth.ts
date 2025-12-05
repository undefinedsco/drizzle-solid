import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';

// Load environment variables
loadEnv();
loadEnv({ path: '.env.local', override: true });

export interface AuthConfig {
  clientId?: string;
  clientSecret?: string;
  oidcIssuer?: string;
}

export async function getAuthenticatedSession(config?: AuthConfig): Promise<Session> {
  const session = new Session();
  
  const clientId = config?.clientId || process.env.SOLID_CLIENT_ID;
  const clientSecret = config?.clientSecret || process.env.SOLID_CLIENT_SECRET;
  const oidcIssuer = config?.oidcIssuer || process.env.SOLID_OIDC_ISSUER || 'http://localhost:3000/';

  if (!clientId || !clientSecret) {
    throw new Error('Missing SOLID_CLIENT_ID or SOLID_CLIENT_SECRET');
  }

  await session.login({
    clientId,
    clientSecret,
    oidcIssuer,
    tokenType: 'DPoP'
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Login failed');
  }

  return session;
}

export function getPodBaseUrl(session: Session): string {
  if (!session.info.webId) throw new Error('No WebID');
  // Simple heuristic: remove 'profile/card#me'
  return session.info.webId.split('profile')[0];
}
