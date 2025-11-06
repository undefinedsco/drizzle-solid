#!/usr/bin/env node

/**
 * 纯粹的 Solid Pod 数据清理脚本
 * 
 * 这个脚本只做清理工作：
 * 1. 停止现有的 Solid 服务器
 * 2. 清理所有数据和配置
 * 3. 不做任何自动设置
 */

const fs = require('fs');
const { exec } = require('child_process');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 递归删除目录
function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    log(`✅ 已删除: ${dirPath}`, 'green');
  } else {
    log(`ℹ️  目录不存在: ${dirPath}`, 'blue');
  }
}

// 停止 Solid 服务器进程
async function stopSolidServer() {
  log('\n🛑 停止现有的 Solid 服务器...', 'yellow');
  
  return new Promise((resolve) => {
    exec('pkill -f "community-server"', (error) => {
      if (error) {
        log('   ℹ️  没有找到运行中的服务器进程', 'blue');
      } else {
        log('   ✅ 服务器进程已停止', 'green');
      }
      resolve();
    });
  });
}

// 清理所有数据和配置
async function cleanupData() {
  log('\n🧹 清理现有数据和配置...', 'yellow');
  
  const pathsToClean = [
    './data',
    './solid-server-data', 
    './.solid-server'
    // 保留 .env 文件，不删除用户的认证信息
  ];
  
  pathsToClean.forEach(dirPath => {
    removeDir(dirPath);
  });
  
  log('✅ 数据清理完成', 'green');
}

// 显示清理后的状态
async function showCleanupStatus() {
  log('\n📊 清理状态检查...', 'yellow');
  
  const pathsToCheck = [
    './data',
    './solid-server-data', 
    './.solid-server',
    './.env'
  ];
  
  pathsToCheck.forEach(dirPath => {
    if (fs.existsSync(dirPath)) {
      if (dirPath === './.env') {
        log(`   ✅ 保留: ${dirPath}`, 'green');
      } else {
        log(`   ⚠️  仍存在: ${dirPath}`, 'yellow');
      }
    } else {
      log(`   ✅ 已清理: ${dirPath}`, 'green');
    }
  });
}

// 主函数
async function main() {
  log('🧹 Solid Pod 数据清理脚本', 'cyan');
  log('============================================================', 'cyan');
  log('⚠️  警告：这将删除所有现有的 Pod 数据！', 'red');
  log('✅ 保留：.env 文件（认证信息）', 'green');
  log('');
  
  try {
    await stopSolidServer();
    await sleep(2000); // 等待进程完全停止
    
    await cleanupData();
    await showCleanupStatus();
    
    log('\n🎉 清理完成！', 'green');
    log('============================================================', 'green');
    log('✅ 已清理的内容：', 'green');
    log('   • Pod 数据目录 (./data)', 'blue');
    log('   • 服务器数据 (./solid-server-data)', 'blue');
    log('   • 服务器配置 (./.solid-server)', 'blue');
    log('   • 服务器进程', 'blue');
    log('');
    log('✅ 已保留的内容：', 'green');
    log('   • 认证信息 (.env)', 'blue');
    log('');
    log('💡 接下来你可以：', 'yellow');
    log('   • 手动启动服务器: npm run server:start', 'cyan');
    log('   • 或运行完整设置: npm run example:setup', 'cyan');
    
  } catch (error) {
    log(`\n❌ 清理失败: ${error.message}`, 'red');
    log('💡 请检查错误信息并重试', 'yellow');
    process.exit(1);
  }
}

// 运行脚本
if (require.main === module) {
  main().catch(console.error);
}