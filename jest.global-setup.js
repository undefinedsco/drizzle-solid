const fs = require('fs');
const path = require('path');
const { startServer, isServerUp, BASE_URL } = require('./scripts/start-css-server');

const STATE_FILE = path.join(__dirname, '.jest-solid-server-state.json');
const TEST_POD_NAME = process.env.SOLID_TEST_POD_NAME || 'alice';

module.exports = async () => {
  console.log('🚀 启动全局 Community Solid Server...');
  
  // 检查是否已有服务器运行
  const isRunning = await isServerUp();
  
  if (isRunning) {
    console.log('♻️  检测到服务器已在运行，复用现有服务器');
    
    const state = {
      managed: false, // 不是我们启动的，不要在 teardown 时关闭
      pid: null,
      baseUrl: BASE_URL,
      podName: TEST_POD_NAME,
    };

    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`ℹ️  复用现有 Community Solid Server: ${BASE_URL}`);
    return;
  }

  // 如果没有运行的服务器，才启动新的
  console.log('🆕 启动新的 CSS 服务器...');
  const result = await startServer();
  const baseUrl = result.baseUrl ?? BASE_URL;

  // 确保只使用本地 3000 端口环境
  if (!baseUrl.includes('localhost:3000')) {
    throw new Error(`测试只支持本地 3000 端口环境，当前 baseUrl: ${baseUrl}`);
  }

  const state = {
    managed: !result.alreadyRunning,
    pid: result.pid ?? null,
    baseUrl,
    podName: TEST_POD_NAME,
  };

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  if (result.alreadyRunning) {
    console.log(`ℹ️  复用现有 Community Solid Server: ${baseUrl}`);
  } else {
    console.log(`✅ Community Solid Server started for tests at ${baseUrl} (pid ${state.pid})`);
  }
};


