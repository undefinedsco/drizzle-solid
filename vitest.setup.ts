import { beforeAll } from 'vitest';
import { config as loadEnv } from 'dotenv';
import { getSolidIntegrationMode, getTestPodBase } from './tests/integration/css/xpod-runtime';

type TestSetupState = {
  envBootstrapped: boolean;
  modeAnnounced: boolean;
  consolePatched: boolean;
  streamPatched: boolean;
};

const TEST_SETUP_STATE_KEY = Symbol.for('drizzle-solid.tests.vitest-setup-state');
const QUIET_TEST_PATTERNS = [
  /^\[Patch\] Successfully patched ActionObserverHttp\.onRun in /,
  /^\[getMetadata\]/,
  /^\[writeContainer\]/,
  /^\[writeDocument\]/,
  /^\[ComunicaQuintEngine\.queryQuads\]/,
  /^\[PodRuntime\] X-Request-ID header is /,
  /^⚠️\s+addSource 是高级用法/,
  /^Table .* has autoRegister disabled, skipping TypeIndex registration$/,
  /^(SELECT|INSERT|DELETE) operation completed, \d+ records affected$/,
];
const QUIET_STREAM_PATTERNS = [
  /AppStaticAssetHandler initialized!/,
  /Serving \/app\/ from:/,
  /\[(ApiRuntime|VercelChatService|ChatKitHandler|ProvisionStatusHandler|ApiServer|GatewayProxy)\] \{Primary\}/,
  /\[DEP0060\] DeprecationWarning: The `util\._extend` API is deprecated/,
  /\(Use `node --trace-deprecation .* created\)/,
  /\(Use `node --trace-deprecation .* show where the warning was created\)/,
];

function getTestSetupState(): TestSetupState {
  const globalState = globalThis as typeof globalThis & {
    [TEST_SETUP_STATE_KEY]?: TestSetupState;
  };

  if (!globalState[TEST_SETUP_STATE_KEY]) {
    globalState[TEST_SETUP_STATE_KEY] = {
      envBootstrapped: false,
      modeAnnounced: false,
      consolePatched: false,
      streamPatched: false,
    };
  }

  return globalState[TEST_SETUP_STATE_KEY]!;
}

function bootstrapEnv(): void {
  const state = getTestSetupState();
  if (state.envBootstrapped) {
    return;
  }

  loadEnv({ override: false, quiet: true });
  loadEnv({ path: '.env.local', override: true, quiet: true });
  state.envBootstrapped = true;
}

function bootstrapIntegrationLoggingEnv(): void {
  if (process.env.SOLID_ENABLE_REAL_TESTS !== 'true') {
    return;
  }

  if (!process.env.CSS_LOGGING_LEVEL) {
    process.env.CSS_LOGGING_LEVEL = process.env.XPOD_RUNTIME_LOG_LEVEL ?? 'error';
  }
}

function isVerboseTestOutputEnabled(): boolean {
  return process.env.DRIZZLE_SOLID_TEST_VERBOSE === 'true';
}

function shouldSuppressConsole(args: unknown[]): boolean {
  if (process.env.SOLID_ENABLE_REAL_TESTS === 'true') {
    return true;
  }

  const [firstArg] = args;
  if (typeof firstArg !== 'string') {
    return false;
  }

  return QUIET_TEST_PATTERNS.some((pattern) => pattern.test(firstArg));
}

function installQuietTestConsole(): void {
  const state = getTestSetupState();
  if (state.consolePatched || isVerboseTestOutputEnabled()) {
    return;
  }

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]) => {
    if (!shouldSuppressConsole(args)) {
      originalLog(...args);
    }
  };

  console.warn = (...args: unknown[]) => {
    if (!shouldSuppressConsole(args)) {
      originalWarn(...args);
    }
  };

  console.error = (...args: unknown[]) => {
    if (!shouldSuppressConsole(args)) {
      originalError(...args);
    }
  };

  state.consolePatched = true;
}

function filterQuietStreamChunk(chunk: string): string {
  const hasTrailingNewline = chunk.endsWith('\n');
  const filteredLines = chunk
    .split('\n')
    .filter((line) => !QUIET_STREAM_PATTERNS.some((pattern) => pattern.test(line)));

  const normalizedLines = filteredLines.filter((line, index) => {
    if (!/^(stdout|stderr) \| /.test(line)) {
      return true;
    }

    const nextLine = filteredLines[index + 1];
    return Boolean(nextLine && !/^(stdout|stderr) \| /.test(nextLine));
  });

  if (normalizedLines.length === 0) {
    return '';
  }

  const normalized = normalizedLines.join('\n');
  return hasTrailingNewline ? `${normalized}\n` : normalized;
}

function installQuietTestStreams(): void {
  const state = getTestSetupState();
  if (state.streamPatched || isVerboseTestOutputEnabled() || process.env.SOLID_ENABLE_REAL_TESTS !== 'true') {
    return;
  }

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const wrapWrite = (originalWrite: typeof process.stdout.write): typeof process.stdout.write =>
    ((chunk: any, encoding?: any, callback?: any) => {
      const resolvedEncoding = typeof encoding === 'string' ? encoding : undefined;
      const resolvedCallback = typeof encoding === 'function' ? encoding : callback;
      const text = typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString(resolvedEncoding)
          : String(chunk);
      const filtered = filterQuietStreamChunk(text);

      if (filtered.length === 0) {
        if (typeof resolvedCallback === 'function') {
          resolvedCallback();
        }
        return true;
      }

      return originalWrite(filtered, resolvedEncoding, resolvedCallback);
    }) as typeof process.stdout.write;

  process.stdout.write = wrapWrite(originalStdoutWrite);
  process.stderr.write = wrapWrite(originalStderrWrite);
  state.streamPatched = true;
}

bootstrapEnv();
bootstrapIntegrationLoggingEnv();
installQuietTestConsole();
installQuietTestStreams();

beforeAll(async () => {
  bootstrapEnv();
  const state = getTestSetupState();
  const verbose = isVerboseTestOutputEnabled();

  const mode = getSolidIntegrationMode();
  if (mode === 'disabled') {
    if (verbose && !state.modeAnnounced) {
      console.log('🧪 Running without real Solid integration suites');
      state.modeAnnounced = true;
    }
    return;
  }

  if (mode === 'in-process') {
    if (verbose && !state.modeAnnounced) {
      console.log(`🧪 Using in-process xpod runtime for tests: ${getTestPodBase()}`);
      state.modeAnnounced = true;
    }
    return;
  }

  const oidcIssuer = process.env.SOLID_OIDC_ISSUER;
  if (!oidcIssuer) {
    throw new Error(
      'SOLID_OIDC_ISSUER is required for remote Solid integration tests. Remove remote credentials to fall back to in-process xpod runtime.'
    );
  }

  const baseUrl = process.env.SOLID_TEST_POD_BASE || getTestPodBase();
  if (verbose && !state.modeAnnounced) {
    console.log(`🔗 Using remote Solid server for tests: ${baseUrl} (issuer: ${oidcIssuer})`);
    state.modeAnnounced = true;
  }
});
