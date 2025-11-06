/**
 * 测试基础认证示例
 */

const { spawn } = require('child_process');
const path = require('path');

async function testExample() {
  console.log('🧪 测试基础认证示例...\n');
  
  try {
    // 编译 TypeScript 文件
    console.log('📦 编译 TypeScript...');
    const tscProcess = spawn('npx', ['tsc', '--noEmit', 'examples/01-basic-authentication.ts'], {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    await new Promise((resolve, reject) => {
      tscProcess.on('exit', (code) => {
        if (code === 0) {
          console.log('✅ TypeScript 编译检查通过');
          resolve(void 0);
        } else {
          reject(new Error(`TypeScript 编译失败，退出码: ${code}`));
        }
      });
    });
    
    // 运行示例（如果编译通过）
    console.log('\n🚀 运行示例...');
    const runProcess = spawn('npx', ['ts-node', 'examples/01-basic-authentication.ts'], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, USE_LOCAL_SERVER: 'true' }
    });
    
    // 设置超时，避免无限等待
    const timeout = setTimeout(() => {
      console.log('\n⏰ 示例运行超时，正在停止...');
      runProcess.kill('SIGTERM');
    }, 60000); // 60秒超时
    
    await new Promise((resolve) => {
      runProcess.on('exit', (code) => {
        clearTimeout(timeout);
        console.log(`\n📋 示例执行完成，退出码: ${code}`);
        resolve(void 0);
      });
    });
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  testExample();
}

module.exports = { testExample };