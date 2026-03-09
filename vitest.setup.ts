import { beforeAll, afterAll } from 'vitest';
import { config as loadEnv } from 'dotenv';
import { getSolidIntegrationMode, getTestPodBase, stopSharedNoAuthXpodRuntime } from './tests/integration/css/xpod-runtime';

let envBootstrapped = false;

function bootstrapEnv(): void {
  if (envBootstrapped) {
    return;
  }

  loadEnv({ override: false });
  loadEnv({ path: '.env.local', override: true });
  envBootstrapped = true;
}

beforeAll(async () => {
  bootstrapEnv();

  const mode = getSolidIntegrationMode();
  if (mode === 'disabled') {
    console.log('🧪 Running without real Solid integration suites');
    return;
  }

  if (mode === 'in-process') {
    console.log(`🧪 Using in-process xpod runtime for tests: ${getTestPodBase()}`);
    return;
  }

  const oidcIssuer = process.env.SOLID_OIDC_ISSUER;
  if (!oidcIssuer) {
    throw new Error(
      'SOLID_OIDC_ISSUER is required for remote Solid integration tests. Remove remote credentials to fall back to in-process xpod runtime.'
    );
  }

  const baseUrl = process.env.SOLID_TEST_POD_BASE || getTestPodBase();
  console.log(`🔗 Using remote Solid server for tests: ${baseUrl} (issuer: ${oidcIssuer})`);
});

afterAll(async () => {
  if (getSolidIntegrationMode() === 'in-process') {
    await stopSharedNoAuthXpodRuntime();
  }
}, 180000);
