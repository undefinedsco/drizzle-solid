#!/usr/bin/env node

/**
 * 干净地清理并重新设置 Solid Pod 环境
 * 
 * 这个脚本会：
 * 1. 停止现有的 Solid 服务器
 * 2. 清理所有数据和配置
 * 3. 重新创建预设账户
 * 4. 启动服务器
 * 5. 生成新的认证信息
 */

const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

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

// 创建预设账户配置
async function createPresetConfig() {
  log('\n👥 创建预设账户配置...', 'yellow');
  
  // 确保目录存在
  if (!fs.existsSync('.solid-server')) {
    fs.mkdirSync('.solid-server', { recursive: true });
  }
  
  const presetConfig = {
    "@context": "https://www.w3.org/ns/solid/oidc-context.jsonld",
    "pods": [
      {
        "email": "alice@example.com",
        "password": "alice-password",
        "podName": "alice",
        "webId": "http://localhost:3000/alice/profile/card#me"
      },
      {
        "email": "bob@example.com", 
        "password": "bob-password",
        "podName": "bob",
        "webId": "http://localhost:3000/bob/profile/card#me"
      },
      {
        "email": "charlie@example.com",
        "password": "charlie-password", 
        "podName": "charlie",
        "webId": "http://localhost:3000/charlie/profile/card#me"
      }
    ]
  };
  
  fs.writeFileSync('.solid-server/seeded-pods.json', JSON.stringify(presetConfig, null, 2));
  log('✅ 预设账户配置已创建', 'green');
}

// 启动 Solid 服务器
async function startSolidServer() {
  log('\n🚀 启动 Solid 服务器...', 'yellow');
  
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('npm', ['exec', '@solid/community-server', '--', 
      '--seedConfig', '.solid-server/seeded-pods.json',
      '--port', '3000',
      '--baseUrl', 'http://localhost:3000', 
      '--rootFilePath', './data',
      '--showStackTrace'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    
    let serverReady = false;
    
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Listening to server at http://localhost:3000/')) {
        serverReady = true;
        log('✅ Solid 服务器启动成功', 'green');
        log('📍 服务器地址: http://localhost:3000/', 'blue');
        resolve();
      }
    });
    
    serverProcess.stderr.on('data', (data) => {
      const error = data.toString();
      if (!serverReady && error.includes('Error')) {
        log(`❌ 服务器启动失败: ${error}`, 'red');
        reject(new Error(error));
      }
    });
    
    // 超时处理
    setTimeout(() => {
      if (!serverReady) {
        log('⏰ 服务器启动超时，但可能仍在后台运行', 'yellow');
        resolve();
      }
    }, 10000);
    
    // 让进程在后台运行
    serverProcess.unref();
  });
}

// 等待服务器就绪
async function waitForServer() {
  log('\n⏳ 等待服务器完全就绪...', 'yellow');
  
  for (let i = 0; i < 10; i++) {
    try {
      const response = await fetch('http://localhost:3000/');
      if (response.ok) {
        log('✅ 服务器已就绪', 'green');
        return;
      }
    } catch (error) {
      // 继续等待
    }
    
    await sleep(1000);
    process.stdout.write('.');
  }
  
  log('\n⚠️  服务器可能还在启动中，继续下一步...', 'yellow');
}

// 生成客户端认证信息
async function generateClientCredentials() {
  log('\n🔑 检查客户端认证信息...', 'yellow');
  
  // 如果 .env 文件已存在，就不覆盖
  if (fs.existsSync('.env')) {
    log('✅ .env 文件已存在，保留现有认证信息', 'green');
    
    // 读取并显示现有信息
    try {
      const envContent = fs.readFileSync('.env', 'utf8');
      const clientIdMatch = envContent.match(/SOLID_CLIENT_ID=(.+)/);
      if (clientIdMatch) {
        log(`🆔 现有 Client ID: ${clientIdMatch[1]}`, 'blue');
      }
      log('📄 使用现有的 .env 文件', 'blue');
    } catch (error) {
      log('⚠️  无法读取 .env 文件内容', 'yellow');
    }
    return;
  }
  
  try {
    log('🔄 生成新的客户端认证信息...', 'yellow');
    
    // 为 alice 生成客户端凭据
    const response = await fetch('http://localhost:3000/idp/credentials/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'alice-password',
        name: 'Demo Client'
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const credentials = await response.json();
    
    // 创建 .env 文件
    const envContent = `SOLID_CLIENT_ID=${credentials.id}
SOLID_CLIENT_SECRET=${credentials.secret}
SOLID_OIDC_ISSUER=http://localhost:3000
`;
    
    fs.writeFileSync('.env', envContent);
    
    log('✅ 新的客户端认证信息已生成', 'green');
    log(`🆔 Client ID: ${credentials.id}`, 'blue');
    log(`🔐 Client Secret: ${credentials.secret.substring(0, 20)}...`, 'blue');
    log('📄 认证信息已保存到 .env 文件', 'blue');
    
  } catch (error) {
    log(`❌ 生成认证信息失败: ${error.message}`, 'red');
    log('💡 你可以稍后手动运行: yarn example:auth', 'yellow');
  }
}

// 验证设置
async function verifySetup() {
  log('\n🔍 验证设置...', 'yellow');
  
  try {
    // 检查预设账户
    const accounts = ['alice', 'bob', 'charlie'];
    
    for (const account of accounts) {
      try {
        const response = await fetch(`http://localhost:3000/${account}/profile/card`);
        if (response.ok) {
          log(`   ✅ ${account} 账户可访问`, 'green');
        } else {
          log(`   ⚠️  ${account} 账户响应: ${response.status}`, 'yellow');
        }
      } catch (error) {
        log(`   ❌ ${account} 账户不可访问`, 'red');
      }
    }
    
    // 检查 .env 文件
    if (fs.existsSync('.env')) {
      log('   ✅ .env 文件存在', 'green');
    } else {
      log('   ⚠️  .env 文件不存在', 'yellow');
    }
    
  } catch (error) {
    log(`❌ 验证失败: ${error.message}`, 'red');
  }
}

// 主函数
async function main() {
  log('🚀 Solid Pod 环境清理和重建脚本', 'cyan');
  log('============================================================', 'cyan');
  log('⚠️  警告：这将删除所有现有的 Pod 数据！', 'red');
  log('');
  
  try {
    await stopSolidServer();
    await sleep(2000); // 等待进程完全停止
    
    await cleanupData();
    await createPresetConfig();
    await startSolidServer();
    await waitForServer();
    await generateClientCredentials();
    await verifySetup();
    
    log('\n🎉 环境重建完成！', 'green');
    log('============================================================', 'green');
    log('✅ 可用的测试账户：', 'green');
    log('   • alice@example.com (密码: alice-password)', 'blue');
    log('   • bob@example.com (密码: bob-password)', 'blue');
    log('   • charlie@example.com (密码: charlie-password)', 'blue');
    log('');
    log('🔗 服务器地址: http://localhost:3000/', 'blue');
    log('📄 认证信息已保存到 .env 文件', 'blue');
    log('');
    log('🚀 现在可以运行示例：', 'green');
    log('   yarn example:basic', 'cyan');
    
  } catch (error) {
    log(`\n❌ 脚本执行失败: ${error.message}`, 'red');
    log('💡 请检查错误信息并重试', 'yellow');
    process.exit(1);
  }
}

// 运行脚本
if (require.main === module) {
  main().catch(console.error);
}