#!/usr/bin/env node

/**
 * 统一的 CSS 服务器启动脚本
 * 与测试环境使用相同的配置
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { setTimeout: delay } = require('timers/promises');
const localtunnel = require('localtunnel');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = Number(process.env.SOLID_SERVER_PORT || 3000);
const BASE_URL = process.env.SOLID_SERVER_BASE_URL || `http://localhost:${DEFAULT_PORT}`;
const DATA_DIR = path.join(REPO_ROOT, 'solid-server-data');
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const SEEDED_POD_CONFIG = path.join(CONFIG_DIR, 'seeded-pod-config.json');

const READY_REGEX = /Listening to server at .*localhost:?[0-9]*\/?/;
const START_TIMEOUT_MS = Number(process.env.SOLID_SERVER_START_TIMEOUT || 60_000);

let serverProcess = null;

/**
 * 检查服务器是否已经运行
 */
async function isServerUp() {
  return new Promise((resolve) => {
    const target = new URL('/', ensureTrailingSlash(BASE_URL));
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
    const seededPodConfig = [
      {
        "email": "alice@example.com",
        "password": "alice-password",
        "pods": [
          {
            "name": "alice"
          }
        ]
      },
      {
        "email": "bob@example.com",
        "password": "bob-password", 
        "pods": [
          {
            "name": "bob"
          }
        ]
      },
      {
        "email": "charlie@example.com",
        "password": "charlie-password",
        "pods": [
          {
            "name": "charlie"
          }
        ]
      }
    ];
    fs.writeFileSync(SEEDED_POD_CONFIG, JSON.stringify(seededPodConfig, null, 2));
  }
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
  console.log('🚀 启动全局 Community Solid Server...');
  
  ensureDirectories();

  // 检查是否已经有服务器在运行
  if (await isServerUp()) {
    console.log(`ℹ️  检测到服务器已在运行: ${BASE_URL}`);
    return { alreadyRunning: true, baseUrl: BASE_URL };
  }

  const args = [
    // 使用默认配置，与 01 样例保持一致
    '--port', String(DEFAULT_PORT),
    '--baseUrl', BASE_URL,
    // 移除 --rootFilePath，使用 CSS 默认数据路径，与 01 样例一致
    '--showStackTrace',
    '--loggingLevel', 'info',
    '--seedConfig', SEEDED_POD_CONFIG
  ];

  console.log(`命令: community-solid-server ${args.join(' ')}`);

  // 使用全局安装的 CSS，内置配置完全本地化
  serverProcess = spawn('community-solid-server', args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_PATH: '' // 清空 NODE_PATH 避免冲突
      // 不需要额外的网络隔离，@css:config/file.json 已经是完全本地化的
    }
  });

  try {
    await waitForServerReady(serverProcess);
    return { 
      alreadyRunning: false, 
      baseUrl: BASE_URL, 
      pid: serverProcess.pid 
    };
  } catch (error) {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
    throw error;
  }
}

/**
 * 停止服务器
 */
async function stopServer() {
  if (!serverProcess || serverProcess.killed) {
    return;
  }

  console.log('🛑 正在停止 Community Solid Server...');
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
      resolve();
    }, 5000);

    serverProcess.once('exit', () => {
      clearTimeout(timeout);
      console.log('✅ Community Solid Server 已停止');
      resolve();
    });

    serverProcess.kill('SIGTERM');
  });
}

// 如果直接运行此脚本，启动服务器
if (require.main === module) {
  console.log('🚀 启动独立的 Community Solid Server...');
  console.log('============================================================');
  
  startServer()
    .then((result) => {
      if (result.alreadyRunning) {
        console.log(`ℹ️  服务器已在运行: ${result.baseUrl}`);
      } else {
        console.log(`✅ 服务器启动成功: ${result.baseUrl} (pid: ${result.pid})`);
      }
      
      // 优雅关闭
      process.on('SIGINT', async () => {
        console.log('\n🛑 收到中断信号，正在关闭服务器...');
        await stopServer();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.log('\n🛑 收到终止信号，正在关闭服务器...');
        await stopServer();
        process.exit(0);
      });
    })
    .catch((error) => {
      console.error('❌ 服务器启动失败:', error.message);
      process.exit(1);
    });
}

module.exports = {
  startServer,
  stopServer,
  isServerUp,
  BASE_URL
};