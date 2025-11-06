import { beforeAll, afterAll } from 'vitest';
import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(__dirname, '.jest-solid-server-state.json');

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
  const state = {
    managed: false,
    pid: null,
    baseUrl,
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`🔗 Using remote Solid server for tests: ${baseUrl}`);
});

afterAll(async () => {
  // Cleanup logic from jest.global-teardown.js if needed
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
});