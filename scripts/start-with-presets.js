/**
 * 启动带预设账户的 Community Solid Server
 */

const { spawn } = require('child_process');
const { setupPresetAccounts } = require('./setup-preset-accounts');
const path = require('path');

/**
 * 启动 Community Solid Server 并预设账户
 */
async function startServerWithPresets() {
  console.log('🚀 启动带预设账户的 Solid 服务器...\n');
  
  try {
    // 1. 设置预设账户
    await setupPresetAccounts();
    
    // 2. 启动服务器
    console.log('\n🔄 启动 Community Solid Server...');
    
    const serverProcess = spawn('npx', [
      '@solid/community-server',
      '--seedConfig', path.join(__dirname, '../.solid-server/seeded-pods.json'),
      '--port', '3000',
      '--baseUrl', 'http://localhost:3000',
      '--rootFilePath', './data',
      '--showStackTrace'
    ], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    // 处理服务器进程事件
    serverProcess.on('error', (error) => {
      console.error('❌ 服务器启动失败:', error.message);
    });

    serverProcess.on('exit', (code) => {
      if (code === 0) {
        console.log('✅ 服务器正常退出');
      } else {
        console.log(`⚠️ 服务器退出，代码: ${code}`);
      }
    });

    // 等待服务器启动
    console.log('⏳ 等待服务器启动...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('\n✨ 服务器启动完成！');
    console.log('🌐 访问地址: http://localhost:3000');
    console.log('\n👥 预设账户:');
    console.log('   Alice: alice@example.com / alice123');
    console.log('   Bob: bob@example.com / bob123');
    console.log('\n💡 提示: 使用 Ctrl+C 停止服务器');

    // 保持进程运行
    process.on('SIGINT', () => {
      console.log('\n🛑 正在停止服务器...');
      serverProcess.kill('SIGINT');
      process.exit(0);
    });

    return serverProcess;
    
  } catch (error) {
    console.error('❌ 启动失败:', error.message);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  startServerWithPresets();
}

module.exports = { startServerWithPresets };