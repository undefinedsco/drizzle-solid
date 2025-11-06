#!/usr/bin/env node

/**
 * 检查本地 Solid 服务器状态
 */

const http = require('http');

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          text: () => Promise.resolve(data),
          ok: res.statusCode >= 200 && res.statusCode < 300
        });
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

async function checkServer() {
  console.log('🔍 检查本地 Solid 服务器状态\n');
  
  try {
    // 检查根目录
    console.log('📋 检查服务器根目录:');
    const rootResponse = await httpRequest('http://localhost:3000/', {
      headers: { 'Accept': 'text/turtle, application/ld+json, text/html' }
    });
    
    console.log(`   状态: ${rootResponse.status}`);
    console.log(`   Content-Type: ${rootResponse.headers['content-type']}`);
    
    if (rootResponse.ok) {
      const content = await rootResponse.text();
      console.log(`   内容长度: ${content.length} 字节`);
      console.log(`   内容预览: ${content.substring(0, 200)}...`);
    }
    
    // 检查 .account 端点
    console.log('\n📋 检查账户管理端点:');
    const accountResponse = await httpRequest('http://localhost:3000/.account/', {
      headers: { 'Accept': 'text/html' }
    });
    
    console.log(`   .account/ 状态: ${accountResponse.status}`);
    
    // 检查 idp 端点
    console.log('\n📋 检查身份提供者端点:');
    const idpResponse = await httpRequest('http://localhost:3000/idp/', {
      headers: { 'Accept': 'text/html' }
    });
    
    console.log(`   idp/ 状态: ${idpResponse.status}`);
    
    // 尝试创建 Pod
    console.log('\n🔧 尝试为 alice 创建 Pod:');
    
    // 首先检查是否已经有 Pod
    const alicePodResponse = await httpRequest('http://localhost:3000/alice/', {
      method: 'HEAD'
    });
    
    console.log(`   alice/ 状态: ${alicePodResponse.status}`);
    
    if (alicePodResponse.status === 404) {
      console.log('   Pod 不存在，需要通过 Web 界面创建');
      console.log('   💡 请访问: http://localhost:3000/.account/');
    } else if (alicePodResponse.ok) {
      console.log('   ✅ Pod 已存在，检查 profile');
      
      const profileResponse = await httpRequest('http://localhost:3000/alice/profile/card', {
        headers: { 'Accept': 'text/turtle' }
      });
      
      console.log(`   profile/card 状态: ${profileResponse.status}`);
      
      if (profileResponse.ok) {
        const profileContent = await profileResponse.text();
        console.log(`   Profile 内容长度: ${profileContent.length} 字节`);
        console.log(`   Profile 预览: ${profileContent.substring(0, 300)}...`);
      }
    }
    
  } catch (error) {
    console.error('❌ 检查失败:', error.message);
  }
}

checkServer();