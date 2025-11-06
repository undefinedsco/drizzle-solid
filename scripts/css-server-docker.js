#!/usr/bin/env node

/**
 * 使用 Docker 启动 CSS 服务器，完全避免版本冲突
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { setTimeout: delay } = require('timers/promises');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = Number(process.env.SOLID_SERVER_PORT || 3000);
const BASE_URL = process.env.SOLID_SERVER_BASE_URL || `http://localhost:${DEFAULT_PORT}`;
const DATA_DIR = path.join(REPO_ROOT, 'solid-server-data');
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const SEEDED_POD_CONFIG = path.join(CONFIG_DIR, 'seeded-pod-config.json');

const READY_REGEX = /Listening to server at .*localhost:?[0-9]*\/?/;
const START_TIMEOUT_MS = Number(process.env.SOLID_SERVER_START_TIMEOUT || 30_000);

let dockerProcess = null;

/**
 * 检查 Docker 是否可用
 */
async function checkDockerAvailable() {
  return new Promise((resolve) => {
    const child = spawn('docker', ['--version'], { stdio: 'ignore' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/**
 * 检查服务器是否已经运行
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

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // 创建预设账户配置
  if (!fs.existsSync(SEEDED_POD_CONFIG)) {
    const seededPodConfig = {
      "@context": "https://linkedsoftwaredependencies.org/bundles/npm/@solid/community-server/^7.0.0/components/context.jsonld",
      "@graph": [
        {
          "@id": "urn:solid-server:default:PodManager",
          "@type": "StaticPodManager",
          "pods": {
            "alice": {
              "email": "alice@example.com",
              "webId": "http://localhost:3000/alice/profile/card#me",
              "settings": {}
            },
            "bob": {
              "email": "bob@example.com", 
              "webId": "http://localhost:3000/bob/profile/card#me",
              "settings": {}
            },
            "charlie": {
              "email": "charlie@example.com",
              "webId": "http://localhost:3000/charlie/profile/card#me", 
              "settings": {}
            }
          }
        }
      ]
    };
    fs.writeFileSync(SEEDED_POD_CONFIG, JSON.stringify(seededPodConfig, null, 2));
  }
}

/**
 * 构建 Docker 镜像
 */
async function buildDockerImage() {
  return new Promise((resolve, reject) => {
    console.log('🔨 构建 CSS Docker 镜像...');
    const child = spawn('docker', [
      'build',
      '-f', path.join(REPO_ROOT, 'docker', 'Dockerfile.css'),
      '-t', 'css-server',
      '.'
    ], {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker build failed with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * 等待服务器启动
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
 * 启动服务器
 */
async function startServer() {
  ensureDirectories();

  if (await isServerUp()) {
    return { alreadyRunning: true, baseUrl: ensureTrailingSlash(BASE_URL) };
  }

  const dockerAvailable = await checkDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker 不可用。请安装 Docker 或使用其他启动方式。');
  }

  // 构建镜像
  await buildDockerImage();

  console.log('🚀 使用 Docker 启动 Community Solid Server...');

  const args = [
    'run',
    '--rm',
    '-p', `${DEFAULT_PORT}:3000`,
    '-v', `${DATA_DIR}:/app/data`,
    '-v', `${SEEDED_POD_CONFIG}:/app/seeded-pod-config.json`,
    'css-server',
    'community-solid-server',
    '--port', '3000',
    '--baseUrl', 'http://localhost:3000/',
    '--rootFilePath', '/app/data',
    '--showStackTrace',
    '--logLevel', 'info',
    '--seededPodConfigJson', '/app/seeded-pod-config.json'
  ];

  dockerProcess = spawn('docker', args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(dockerProcess);

  dockerProcess.unref();
  dockerProcess.stdout?.unref?.();
  dockerProcess.stderr?.unref?.();

  // 给 CSS 一点时间完成初始化
  await delay(250);

  return { alreadyRunning: false, pid: dockerProcess.pid, baseUrl: ensureTrailingSlash(BASE_URL) };
}

/**
 * 停止服务器
 */
async function stopServer(pid) {
  if (dockerProcess) {
    console.log('🛑 停止 Docker CSS 服务器...');
    dockerProcess.kill('SIGTERM');
    dockerProcess = null;
  }
}

module.exports = {
  startServer,
  stopServer,
  DEFAULT_PORT,
  BASE_URL: ensureTrailingSlash(BASE_URL),
  SEEDED_POD_CONFIG,
  DATA_DIR,
};