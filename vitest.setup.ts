import { beforeAll, afterAll } from 'vitest';
import { config as loadEnv } from 'dotenv';

function bootstrapEnv() {
  loadEnv({ path: '.env.local', override: false });
  loadEnv();
}

beforeAll(async () => {
  bootstrapEnv();

  const oidcIssuer = process.env.SOLID_OIDC_ISSUER;
  if (!oidcIssuer) {
    throw new Error(
      'SOLID_OIDC_ISSUER is required for integration tests. Please point it to your remote Solid server.'
    );
  }

  const baseUrl = process.env.SOLID_TEST_POD_BASE || oidcIssuer;
  console.log(`🔗 Using remote Solid server for tests: ${baseUrl}`);
});

afterAll(async () => {
  // No-op cleanup hook for compatibility with legacy Jest setup
});
