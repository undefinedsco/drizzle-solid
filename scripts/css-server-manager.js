#!/usr/bin/env node

/**
 * Helper to programmatically manage a local Community Solid Server instance.
 *
 * Jest (and other tooling) can import this module to ensure a predictable
 * lifecycle for the local CSS process without depending on manual `npx`
 * invocations.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { setTimeout: delay } = require('timers/promises');

const REPO_ROOT = path.join(__dirname, '..');
const CSS_RUNTIME_DIR = path.join(REPO_ROOT, '.internal', 'css-runtime');
const CSS_RUNTIME_NODE_MODULES = path.join(CSS_RUNTIME_DIR, 'node_modules');
const DEFAULT_PORT = Number(process.env.SOLID_SERVER_PORT || 3000);
const BASE_URL = process.env.SOLID_SERVER_BASE_URL || `http://localhost:${DEFAULT_PORT}`;

let CSS_BIN;

function resolveCssBin() {
  if (CSS_BIN) return CSS_BIN;

  const runtimeCandidate = path.join(
    CSS_RUNTIME_NODE_MODULES,
    '@solid',
    'community-server',
    'bin',
    'server.js'
  );

  if (fs.existsSync(runtimeCandidate)) {
    CSS_BIN = runtimeCandidate;
    return CSS_BIN;
  }

  const hint = [
    'Expected isolated Community Solid Server runtime under `.internal/css-runtime`.',
    'Install it with `yarn --cwd .internal/css-runtime install` before running integration tests.'
  ].join(' ');

  throw new Error(hint);
}

function collectNodeModuleDirs(baseDir, depth = 2, acc = new Set()) {
  if (depth < 0 || !baseDir) return acc;
  try {
    const stat = fs.statSync(baseDir);
    if (!stat.isDirectory()) return acc;
  } catch {
    return acc;
  }

  acc.add(baseDir);

  try {
    for (const entry of fs.readdirSync(baseDir)) {
      if (entry.startsWith('.')) continue;
      const full = path.join(baseDir, entry);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (entry === 'node_modules') {
        collectNodeModuleDirs(full, depth - 1, acc);
        continue;
      }
      const nested = path.join(full, 'node_modules');
      collectNodeModuleDirs(nested, depth - 1, acc);
      if (entry.startsWith('@')) {
        collectNodeModuleDirs(full, depth - 1, acc);
      }
    }
  } catch {
    // ignore
  }

  return acc;
}

const DATA_DIR = path.join(REPO_ROOT, 'solid-server-data');
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const SEEDED_POD_CONFIG = path.join(CONFIG_DIR, 'seeded-pod-config.json');
const DEFAULT_SERVER_CONFIG = path.join(CONFIG_DIR, 'server-config.json');
const CUSTOM_SERVER_CONFIG = process.env.SOLID_SERVER_CONFIG_PATH
  ? path.resolve(process.cwd(), process.env.SOLID_SERVER_CONFIG_PATH)
  : process.env.SOLID_SERVER_USE_DEFAULT_CONFIG === 'true'
    ? DEFAULT_SERVER_CONFIG
    : null;

const READY_REGEX = /Listening to server at .*localhost:?[0-9]*\/?/;
const START_TIMEOUT_MS = Number(process.env.SOLID_SERVER_START_TIMEOUT || 30_000);

/**
 * Simple GET request wrapper to check if the server is already running.
 */
async function isServerUp() {
  return new Promise((resolve) => {
    const target = new URL('/.well-known/openid_configuration', ensureTrailingSlash(BASE_URL));
    const req = http.get(target, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(2_000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(CSS_RUNTIME_NODE_MODULES)) {
    throw new Error('Missing CSS runtime modules. Run `yarn css:install` to populate `.internal/css-runtime`.');
  }

  if (!fs.existsSync(CONFIG_DIR)) {
    throw new Error(`Missing config directory: ${CONFIG_DIR}`);
  }

  if (!fs.existsSync(SEEDED_POD_CONFIG)) {
    throw new Error(`Missing seeded pod config: ${SEEDED_POD_CONFIG}`);
  }

  if (CUSTOM_SERVER_CONFIG && !fs.existsSync(CUSTOM_SERVER_CONFIG)) {
    throw new Error(`Missing server config: ${CUSTOM_SERVER_CONFIG}`);
  }
}

/**
 * Wait until the CSS process reports it is ready or fail after a timeout.
 */
async function waitForServerReady(child) {
  let accumulatedStdout = '';
  let accumulatedStderr = '';

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (cb) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('error', onError);
      child.off('exit', onExit);
      cb();
    };

    const timeout = setTimeout(() => {
      finish(() => {
        child.kill('SIGTERM');
        reject(new Error(`Community Solid Server start timed out after ${START_TIMEOUT_MS}ms.\nstdout:\n${accumulatedStdout}\nstderr:\n${accumulatedStderr}`));
      });
    }, START_TIMEOUT_MS);

    const onStdout = (chunk) => {
      const text = chunk.toString();
      accumulatedStdout += text;

      if (process.env.SOLID_SERVER_VERBOSE === 'true') {
        process.stdout.write(`[css] ${text}`);
      }

      if (!settled && READY_REGEX.test(text)) {
        finish(() => resolve());
      }
    };

    const onStderr = (chunk) => {
      const text = chunk.toString();
      accumulatedStderr += text;

      if (process.env.SOLID_SERVER_VERBOSE === 'true') {
        process.stderr.write(`[css] ${text}`);
      }
    };

    const onError = (error) => {
      finish(() => reject(error));
    };

    const onExit = (code, signal) => {
      finish(() => {
        reject(new Error(`Community Solid Server exited prematurely (code: ${code}, signal: ${signal}).\nstdout:\n${accumulatedStdout}\nstderr:\n${accumulatedStderr}`));
      });
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/**
 * Start the local Community Solid Server if it isn't already running.
 *
 * @returns {Promise<{ alreadyRunning: boolean, pid?: number, baseUrl: string }>} metadata about the server state
 */
async function startServer() {
  ensureDirectories();

  if (await isServerUp()) {
    return { alreadyRunning: true, baseUrl: ensureTrailingSlash(BASE_URL) };
  }

  const args = [
    resolveCssBin(),
    '--port', String(DEFAULT_PORT),
    '--baseUrl', ensureTrailingSlash(BASE_URL),
    '--rootFilePath', DATA_DIR,
    '--showStackTrace',
    '--logLevel', 'info',
    '--seededPodConfigJson', SEEDED_POD_CONFIG,
  ];

  if (CUSTOM_SERVER_CONFIG) {
    args.push('--config', CUSTOM_SERVER_CONFIG);
  }

  const shimPath = path.join(__dirname, 'css-context-shim.js');
  // 完全隔离的环境，只使用 CSS 运行时的依赖
  const child = spawn(process.execPath, args, {
    cwd: CSS_RUNTIME_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      // 只保留必要的环境变量，避免继承项目的 NODE_PATH 等
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV || 'test',
      // 强制使用 CSS 运行时的 node_modules
      NODE_PATH: CSS_RUNTIME_NODE_MODULES,
      // 禁用全局模块查找
      NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main',
    },
  });

  await waitForServerReady(child);

  child.unref();
  child.stdout?.unref?.();
  child.stderr?.unref?.();

  // Give CSS a brief additional moment to finish initialization tasks.
  await delay(250);

  return { alreadyRunning: false, pid: child.pid, baseUrl: ensureTrailingSlash(BASE_URL) };
}

/**
 * Stop a previously started Community Solid Server process by PID.
 */
async function stopServer(pid) {
  if (!pid) return;

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') {
      return;
    }
    throw error;
  }

  // Give the process a moment to exit gracefully, then escalate if needed.
  const deadline = Date.now() + 10_000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() > deadline) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          throw error;
        }
      }
      return;
    }

    try {
      process.kill(pid, 0);
      await delay(250);
    } catch (error) {
      if (error.code === 'ESRCH') {
        return;
      }
      throw error;
    }
  }
}

module.exports = {
  startServer,
  stopServer,
  DEFAULT_PORT,
  BASE_URL: ensureTrailingSlash(BASE_URL),
  SEEDED_POD_CONFIG,
  SERVER_CONFIG: CUSTOM_SERVER_CONFIG,
  DATA_DIR,
};
