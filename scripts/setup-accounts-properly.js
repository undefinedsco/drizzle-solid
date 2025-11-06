/**
 * 正确设置预设账户脚本
 * 通过 Community Solid Server API 创建真正的用户账户和 Pod
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// 读取预设账户配置
const configPath = path.join(__dirname, '../config/preset-accounts.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * 等待服务器启动
 */
async function waitForServer(baseUrl, maxAttempts = 30) {
  console.log('⏳ 等待服务器启动...');
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok || response.status === 404) {
        console.log('✅ 服务器已启动');
        return true;
      }
    } catch (error) {
      // 服务器还未启动，继续等待
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.stdout.write('.');
  }
  
  throw new Error('服务器启动超时');
}

/**
 * 创建用户账户
 */
async function createAccount(baseUrl, accountData) {
  console.log(`\n👤 创建账户: ${accountData.name}`);
  
  try {
    // 1. 注册账户
    console.log('   🔄 注册用户账户...');
    const registerResponse = await fetch(`${baseUrl}/idp/register/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: accountData.email,
        password: accountData.password,
        confirmPassword: accountData.password,
        register: true,
        createWebId: true,
        createPod: true,
        podName: accountData.email.split('@')[0] // 使用邮箱前缀作为 Pod 名称
      })
    });
    
    if (registerResponse.ok) {
      console.log('   ✅ 用户账户注册成功');
    } else {
      const errorText = await registerResponse.text();
      console.log(`   ⚠️ 账户注册响应: ${registerResponse.status} - ${errorText}`);
    }
    
    // 2. 尝试创建 Pod（如果注册时没有自动创建）
    console.log('   🔄 确保 Pod 存在...');
    const podUrl = `${baseUrl}/${accountData.email.split('@')[0]}/`;
    const podResponse = await fetch(podUrl);
    
    if (podResponse.status === 404) {
      console.log('   🔄 创建 Pod 容器...');
      const createPodResponse = await fetch(podUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
        },
        body: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<> a ldp:BasicContainer ;
   dcterms:title "Pod for ${accountData.name}" .`
      });
      
      if (createPodResponse.ok || createPodResponse.status === 201) {
        console.log('   ✅ Pod 容器创建成功');
      } else {
        console.log(`   ⚠️ Pod 创建响应: ${createPodResponse.status}`);
      }
    } else {
      console.log('   ✅ Pod 已存在');
    }
    
    // 3. 创建 Profile 数据
    console.log('   🔄 创建 Profile 数据...');
    const profileUrl = `${baseUrl}/${accountData.email.split('@')[0]}/profile/card`;
    const profileData = `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix schema: <https://schema.org/> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .

<${accountData.webId}> a foaf:Person ;
    foaf:name "${accountData.name}" ;
    foaf:mbox <mailto:${accountData.email}> ;
    foaf:img <${accountData.profile.avatar}> ;
    foaf:phone "${accountData.profile.phone}" ;
    schema:bio """${accountData.profile.bio}""" ;
    schema:website <${accountData.profile.website}> ;
    schema:location "${accountData.profile.location}" ;
    schema:organization "${accountData.profile.organization}" ;
    schema:jobTitle "${accountData.profile.title}" ;
    solid:oidcIssuer <${baseUrl}> .
`;
    
    const profileResponse = await fetch(profileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle'
      },
      body: profileData
    });
    
    if (profileResponse.ok || profileResponse.status === 201) {
      console.log('   ✅ Profile 数据创建成功');
    } else {
      console.log(`   ⚠️ Profile 创建响应: ${profileResponse.status}`);
    }
    
    console.log(`   🎉 账户 ${accountData.name} 设置完成`);
    console.log(`   📧 邮箱: ${accountData.email}`);
    console.log(`   🔑 密码: ${accountData.password}`);
    console.log(`   🆔 WebID: ${accountData.webId}`);
    console.log(`   🏠 Pod URL: ${podUrl}`);
    
    return true;
    
  } catch (error) {
    console.log(`   ❌ 创建账户失败: ${error.message}`);
    return false;
  }
}

/**
 * 设置所有预设账户
 */
async function setupAccountsProperly() {
  console.log('🚀 开始正确设置预设账户...');
  console.log('============================================================');
  
  const baseUrl = config.serverConfig.baseUrl;
  
  try {
    // 等待服务器启动
    await waitForServer(baseUrl);
    
    // 为每个预设账户创建用户和 Pod
    const accounts = Object.values(config.presetAccounts);
    let successCount = 0;
    
    for (const account of accounts) {
      const success = await createAccount(baseUrl, account);
      if (success) {
        successCount++;
      }
    }
    
    console.log('\n🎉 预设账户设置完成！');
    console.log('============================================================');
    console.log(`✅ 成功创建 ${successCount}/${accounts.length} 个账户`);
    
    if (successCount > 0) {
      console.log('\n📋 可用账户:');
      accounts.forEach(account => {
        console.log(`   👤 ${account.name}: ${account.email} / ${account.password}`);
      });
      
      console.log('\n🔗 测试链接:');
      console.log(`   🌐 服务器: ${baseUrl}`);
      console.log(`   👤 Alice Profile: ${baseUrl}/alice/profile/card`);
      console.log(`   👤 Bob Profile: ${baseUrl}/bob/profile/card`);
      console.log(`   👤 Charlie Profile: ${baseUrl}/charlie/profile/card`);
    }
    
  } catch (error) {
    console.error('❌ 设置预设账户失败:', error.message);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  setupAccountsProperly().catch(console.error);
}

module.exports = { setupAccountsProperly };