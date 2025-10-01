#!/usr/bin/env ts-node

/**
 * Drizzle Solid 示例 1: 服务器设置、Pod创建和Credential Tokens配置
 * 
 * 这个示例展示如何：
 * 1. 启动本地Community Solid Server
 * 2. 引导用户创建Pod
 * 3. 创建Credential Tokens用于API认证
 * 4. 为下个示例准备认证信息
 */

import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';

// 创建readline接口用于用户交互
const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

// 提示用户输入的辅助函数
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// 检查服务器是否运行
async function checkServerStatus(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:3000/.well-known/openid_configuration');
    return response.ok;
  } catch {
    return false;
  }
}

// 启动Community Solid Server
async function startSolidServer(): Promise<ChildProcess | null> {
  console.log('🚀 启动 Community Solid Server...');
  
  const serverProcess = spawn('npx', ['@solid/community-server'], {
    stdio: 'pipe',
    cwd: process.cwd()
  });

  // 等待服务器启动
  return new Promise((resolve) => {
    let serverReady = false;
    
    const timeout = setTimeout(() => {
      if (!serverReady) {
        console.log('❌ 服务器启动超时');
        serverProcess.kill();
        resolve(null);
      }
    }, 30000);

    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Listening to server at http://localhost:3000/')) {
        serverReady = true;
        clearTimeout(timeout);
        console.log('✅ Community Solid Server 启动成功');
        console.log('📍 服务器地址: http://localhost:3000/');
        resolve(serverProcess);
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      const errorOutput = data.toString();
      console.error('服务器错误:', errorOutput);
      
      // 检查端口占用错误
      if (errorOutput.includes('EADDRINUSE') && errorOutput.includes('3000')) {
        serverReady = true;
        clearTimeout(timeout);
        console.log('💡 端口3000已被占用，可能服务器已在运行');
        serverProcess.kill();
        resolve(null); // 返回null表示不需要管理服务器进程
      }
    });

    serverProcess.on('error', (error) => {
      console.error('❌ 启动服务器失败:', error.message);
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

// 引导用户创建Pod
async function guidePodCreation(): Promise<void> {
  console.log('\n🏠 Pod 创建指南');
  console.log('============================================================');
  console.log('现在您需要创建一个Solid Pod来存储数据。请按照以下步骤操作：');
  console.log('');
  console.log('📋 步骤1: 使用预设账户或注册新账户');
  console.log('   💡 服务器已预设以下测试账户，可直接使用：');
  console.log('      - alice@example.com / alice-password');
  console.log('      - bob@example.com / bob-password');
  console.log('      - charlie@example.com / charlie-password');
  console.log('');
  console.log('   选项A: 使用预设账户（推荐）');
  console.log('      直接跳到步骤2，使用上述账户信息登录');
  console.log('');
  console.log('   选项B: 注册新账户');
  console.log('      1. 在浏览器中打开: http://localhost:3000/.account/register/');
  console.log('      2. 填写注册信息：');
  console.log('         - Email: 任意邮箱地址');
  console.log('         - Password: 设置一个密码');
  console.log('         - Pod Name: 选择一个Pod名称');
  console.log('      3. 点击 "Register" 完成注册');
  console.log('');
  console.log('📋 步骤2: 创建Pod');
  console.log('   1. 注册成功后会自动跳转到Pod创建页面');
  console.log('   2. 点击 "Create Pod" 按钮');
  console.log('   3. Pod创建成功后，您会看到WebID信息');
  console.log('   4. WebID格式类似: http://localhost:3000/alice/profile/card#me');
  console.log('');
  console.log('💡 重要提示：');
  console.log('   - 请记住您的WebID，下个示例会用到');
  console.log('   - 确保Pod创建成功后再继续');
  console.log('   - 如果遇到问题，请检查浏览器控制台');
  console.log('');
  
  await askQuestion('按回车键继续，当您已经完成注册和Pod创建...');
}

// 引导用户创建Credential Tokens
async function guideTokenCreation(): Promise<void> {
  console.log('\n🔑 Credential Tokens 创建指南');
  console.log('============================================================');
  console.log('为了在Node.js应用中进行API认证，您需要创建Credential Tokens。');
  console.log('这些tokens将用于下个示例中的身份验证。');
  console.log('');
  console.log('📋 步骤1: 登录账户');
  console.log('   1. 在浏览器中打开: http://localhost:3000/.account/login/');
  console.log('   2. 使用账户信息登录：');
  console.log('      - 预设账户: alice@example.com / alice-password');
  console.log('      - 或使用您注册的账户信息');
  console.log('');
  console.log('📋 步骤2: 访问Token管理页面');
  console.log('   1. 登录成功后，访问: http://localhost:3000/.account/');
  console.log('   2. 在账户页面中找到 "Credential tokens" 部分');
  console.log('   3. 您会看到 "The tokens created by this account." 的说明');
  console.log('');
  console.log('📋 步骤3: 创建新Token');
  console.log('   1. 点击 "Create token" 或类似的按钮');
  console.log('   2. 填写Token信息：');
  console.log('      - Name: drizzle-solid-demo (或您喜欢的名称)');
  console.log('      - Description: Token for drizzle-solid examples');
  console.log('   3. 选择权限范围 (通常选择 "Read" 和 "Write")');
  console.log('   4. 点击 "Create" 创建Token');
  console.log('');
  console.log('📋 步骤4: 保存Token信息');
  console.log('   1. Token创建成功后，您会看到：');
  console.log('      - Client ID: 类似 "abc123def456..."');
  console.log('      - Client Secret: 类似 "xyz789uvw012..."');
  console.log('   2. ⚠️  重要：立即复制并保存这些信息！');
  console.log('   3. Client Secret只会显示一次，关闭页面后无法再次查看');
  console.log('');
  console.log('💡 使用Token的方法：');
  console.log('   方式1: 设置环境变量');
  console.log('     export SOLID_CLIENT_ID="您的Client ID"');
  console.log('     export SOLID_CLIENT_SECRET="您的Client Secret"');
  console.log('     export SOLID_OIDC_ISSUER="http://localhost:3000"');
  console.log('');
  console.log('   方式2: 直接修改下个示例的代码');
  console.log('     在 examples/02-read-profile.ts 中修改配置');
  console.log('');
  console.log('🔒 安全提示：');
  console.log('   • 不要将Client Secret提交到版本控制系统');
  console.log('   • 在生产环境中使用环境变量存储敏感信息');
  console.log('   • 定期轮换Token以提高安全性');
  console.log('');
  
  await askQuestion('按回车键继续，当您已经完成Token创建并保存了认证信息...');
}

// 主函数
async function main() {
  console.log('🚀 Drizzle Solid 示例 1: 服务器设置和Pod创建');
  console.log('============================================================');
  
  try {
    // 1. 检查服务器状态
    console.log('🔍 检查 Community Solid Server 状态...');
    const serverRunning = await checkServerStatus();
    
    let serverProcess: ChildProcess | null = null;
    
    if (serverRunning) {
      console.log('✅ 服务器已在运行');
    } else {
      // 2. 启动服务器
      serverProcess = await startSolidServer();
      if (!serverProcess) {
        console.log('❌ 无法启动服务器，请检查配置');
        process.exit(1);
      }
      
      // 等待服务器完全启动
      console.log('⏳ 等待服务器完全启动...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // 3. 引导用户创建Pod
    await guidePodCreation();
    
    // 4. 引导用户创建Credential Tokens
    await guideTokenCreation();
    
    // 5. 完成设置
    console.log('\n🎉 设置完成！');
    console.log('============================================================');
    console.log('✅ Community Solid Server 正在运行');
    console.log('✅ Pod 创建指导已完成');
    console.log('✅ Credential Tokens 创建指导已完成');
    console.log('');
    console.log('💡 下一步：');
    console.log('   1. 确保您已保存Client ID和Client Secret');
    console.log('   2. 运行示例来测试功能:');
    console.log('      npm run example:auth    # 身份认证测试');
    console.log('      npm run example:usage   # 基本使用方法');
    console.log('');
    console.log('📝 重要提醒：');
    console.log('   • 预设账户信息：');
    console.log('     - alice@example.com / alice-password');
    console.log('     - WebID: http://localhost:3000/alice/profile/card#me');
    console.log('   • Client ID: 从Token页面复制的Client ID');
    console.log('   • Client Secret: 从Token页面复制的Client Secret');
    console.log('   • OIDC Issuer: http://localhost:3000');
    console.log('');
    console.log('🔧 服务器管理：');
    console.log('   - 服务器将继续在后台运行');
    console.log('   - 要停止服务器，请按 Ctrl+C');
    console.log('   - 重启后需要重新运行此示例');

    
    // 保持服务器运行
    if (serverProcess) {
      console.log('\n⏳ 服务器正在运行中... (按 Ctrl+C 停止)');
      
      // 优雅关闭处理
      process.on('SIGINT', () => {
        console.log('\n🛑 正在关闭服务器...');
        serverProcess?.kill();
        rl.close();
        process.exit(0);
      });
      
      // 保持进程运行
      await new Promise(() => {});
    }
    
  } catch (error) {
    console.error('❌ 示例执行失败:', error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// 运行主函数
if (require.main === module) {
  main().catch(console.error);
}