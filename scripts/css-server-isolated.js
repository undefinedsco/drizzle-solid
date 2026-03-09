#!/usr/bin/env node

/**
 * 通过临时移除 Comunica 依赖来启动 CSS 服务器
 * 这是最简单有效的解决方案
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
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');
const PACKAGE_JSON_BACKUP = path.join(REPO_ROOT, 'package.json.backup');
const NODE_MODULES_COMUNICA = path.join(REPO_ROOT, 'node_modules', '@comunica');
const NODE_MODULES_COMUNICA_BACKUP = path.join(REPO_ROOT, 'node_modules', '@comunica.backup');

const READY_REGEX = /Listening to server at .*localhost:?[0-9]*\/?/;
const START_TIMEOUT_MS = Number(process.env.SOLID_SERVER_START_TIMEOUT || 30_000);

let isIsolated = false;

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
      "@context": "https://linkedsoftwaredependencies.org/bundles/npm/@solid/community-server/^8.0.0/components/context.jsonld",
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
 * 临时隔离 Comunica 依赖
 */
function isolateComunica() {
  if (isIsolated) return;

  console.log('🔧 临时隔离 Comunica 依赖以避免版本冲突...');

  // 备份并修改 package.json
  if (fs.existsSync(PACKAGE_JSON_PATH) && !fs.existsSync(PACKAGE_JSON_BACKUP)) {
    fs.copyFileSync(PACKAGE_JSON_PATH, PACKAGE_JSON_BACKUP);
    
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    if (packageJson.dependencies && packageJson.dependencies['@comunica/query-sparql-solid']) {
      delete packageJson.dependencies['@comunica/query-sparql-solid'];
      fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2));
    }
  }

  // 临时移动 @comunica node_modules
  if (fs.existsSync(NODE_MODULES_COMUNICA) && !fs.existsSync(NODE_MODULES_COMUNICA_BACKUP)) {
    fs.renameSync(NODE_MODULES_COMUNICA, NODE_MODULES_COMUNICA_BACKUP);
  }

  isIsolated = true;
}

/**
 * 恢复 Comunica 依赖
 */
function restoreComunica() {
  if (!isIsolated) return;

  console.log('🔄 恢复 Comunica 依赖...');

  // 恢复 package.json
  if (fs.existsSync(PACKAGE_JSON_BACKUP)) {
    fs.renameSync(PACKAGE_JSON_BACKUP, PACKAGE_JSON_PATH);
  }

  // 恢复 @comunica node_modules
  if (fs.existsSync(NODE_MODULES_COMUNICA_BACKUP)) {
    if (fs.existsSync(NODE_MODULES_COMUNICA)) {
      fs.rmSync(NODE_MODULES_COMUNICA, { recursive: true, force: true });
    }
    fs.renameSync(NODE_MODULES_COMUNICA_BACKUP, NODE_MODULES_COMUNICA);
  }

  isIsolated = false;
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

  // 临时隔离 Comunica 依赖
  isolateComunica();

  try {
    const args = [
      '@solid/community-server',
      '--port', String(DEFAULT_PORT),
      '--baseUrl', ensureTrailingSlash(BASE_URL),
      '--rootFilePath', DATA_DIR,
      '--showStackTrace',
      '--logLevel', 'info',
      '--seededPodConfigJson', SEEDED_POD_CONFIG,
    ];

    console.log('🚀 启动 Community Solid Server (已隔离 Comunica 依赖)...');
    console.log(`命令: npx ${args.join(' ')}`);

    const child = spawn('npx', args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'test',
      },
    });

    await waitForServerReady(child);

    child.unref();
    child.stdout?.unref?.();
    child.stderr?.unref?.();

    // 给 CSS 一点时间完成初始化
    await delay(250);

    return { alreadyRunning: false, pid: child.pid, baseUrl: ensureTrailingSlash(BASE_URL) };
  } catch (error) {
    // 如果启动失败，恢复依赖
    restoreComunica();
    throw error;
  }
}

/**
 * 停止服务器
 */
async function stopServer(pid) {
  if (!pid) {
    // 即使没有 PID，也要恢复依赖
    restoreComunica();
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') {
      restoreComunica();
      return;
    }
    throw error;
  }

  // 给进程一些时间优雅退出
  const deadline = Date.now() + 10_000;
  while (true) {
    if (Date.now() > deadline) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          throw error;
        }
      }
      break;
    }

    try {
      process.kill(pid, 0);
      await delay(250);
    } catch (error) {
      if (error.code === 'ESRCH') {
        break;
      }
      throw error;
    }
  }

  // 恢复 Comunica 依赖
  restoreComunica();
}

// 进程退出时自动恢复依赖
process.on('exit', restoreComunica);
process.on('SIGINT', restoreComunica);
process.on('SIGTERM', restoreComunica);
process.on('uncaughtException', (error) => {
  restoreComunica();
  throw error;
});

module.exports = {
  startServer,
  stopServer,
  DEFAULT_PORT,
  BASE_URL: ensureTrailingSlash(BASE_URL),
  SEEDED_POD_CONFIG,
  DATA_DIR,
};