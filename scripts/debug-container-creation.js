#!/usr/bin/env node

/**
 * 深入调试容器创建问题
 */

async function debugContainerCreation() {
  console.log('🐛 深入调试容器创建');
  console.log('================================\n');
  
  const { Session } = await import('@inrupt/solid-client-authn-node');
  
  const clientId = 'test_3c0a130f-564e-4e5c-9e9e-166bae262471';
  const clientSecret = '782f6e5917037674c44e2a18027fc18b01dc8ab746410532eb0a982ea506f67b7814beedd604fad8851ff77c3b9ac278903580a8261fb5c5ff635916c0306ca2';
  const oidcIssuer = 'http://localhost:3000';
  
  const session = new Session();
  
  try {
    await session.login({
      clientId,
      clientSecret,
      oidcIssuer,
      tokenType: 'Bearer'
    });
    
    console.log('✅ 认证成功');
    
    // 1. 详细检查 alice 根目录
    console.log('\n🔍 详细检查 alice 根目录...');
    const aliceResponse = await session.fetch('http://localhost:3000/alice/', {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    console.log(`📤 Alice 根目录: ${aliceResponse.status}`);
    if (aliceResponse.ok) {
      const content = await aliceResponse.text();
      console.log('📄 完整内容:');
      console.log('-----------------------------------');
      console.log(content);
      console.log('-----------------------------------');
      
      // 查找所有包含的资源
      const lines = content.split('\n');
      const resources = lines.filter(line => line.includes('ldp:contains') || line.includes('contains'));
      console.log('\n📋 包含的资源:');
      resources.forEach(resource => console.log(`   ${resource.trim()}`));
    }
    
    // 2. 尝试创建容器并获取详细响应
    console.log('\n📁 创建容器（详细模式）...');
    const createResponse = await session.fetch('http://localhost:3000/alice/', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/turtle',
        'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        'Slug': 'tasks'
      },
      body: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dc: <http://purl.org/dc/terms/> .

<> a ldp:BasicContainer ;
   dc:title "Tasks Container" .`
    });
    
    console.log(`📤 创建响应: ${createResponse.status}`);
    console.log('📋 响应头:');
    for (const [key, value] of createResponse.headers.entries()) {
      console.log(`   ${key}: ${value}`);
    }
    
    if (createResponse.ok) {
      const responseText = await createResponse.text();
      console.log('📄 响应内容:');
      console.log(responseText || '(空响应)');
      
      // 检查 Location 头
      const location = createResponse.headers.get('Location');
      if (location) {
        console.log(`📍 Location 头: ${location}`);
        
        // 尝试访问 Location 指定的 URL
        console.log('\n🔍 访问 Location URL...');
        const locationResponse = await session.fetch(location, {
          method: 'GET',
          headers: {
            'Accept': 'text/turtle'
          }
        });
        
        console.log(`📤 Location 响应: ${locationResponse.status}`);
        if (locationResponse.ok) {
          const locationContent = await locationResponse.text();
          console.log('📄 Location 内容:');
          console.log('-----------------------------------');
          console.log(locationContent);
          console.log('-----------------------------------');
        } else {
          const errorText = await locationResponse.text();
          console.log(`❌ Location 访问失败: ${errorText.substring(0, 200)}...`);
        }
      }
    } else {
      const errorText = await createResponse.text();
      console.log(`❌ 创建失败: ${errorText}`);
    }
    
    // 3. 再次检查 alice 根目录看是否有变化
    console.log('\n🔍 再次检查 alice 根目录...');
    const aliceResponse2 = await session.fetch('http://localhost:3000/alice/', {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (aliceResponse2.ok) {
      const content2 = await aliceResponse2.text();
      const hasTasks = content2.includes('tasks');
      console.log(`📋 现在包含 'tasks': ${hasTasks ? '✅' : '❌'}`);
      
      if (hasTasks) {
        // 找到 tasks 的具体 URL
        const lines = content2.split('\n');
        const tasksLine = lines.find(line => line.includes('tasks'));
        console.log(`📍 Tasks 行: ${tasksLine}`);
      }
    }
    
    // 4. 尝试不同的 tasks URL
    const possibleUrls = [
      'http://localhost:3000/alice/tasks/',
      'http://localhost:3000/alice/tasks',
      'http://localhost:3000/alice/tasks.ttl'
    ];
    
    console.log('\n🔍 尝试不同的 tasks URL...');
    for (const url of possibleUrls) {
      console.log(`\n📍 尝试: ${url}`);
      const testResponse = await session.fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });
      
      console.log(`📤 响应: ${testResponse.status}`);
      if (testResponse.ok) {
        console.log('✅ 找到了！');
        const content = await testResponse.text();
        console.log('📄 内容预览:');
        console.log(content.substring(0, 200) + '...');
        break;
      }
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 调试失败: ${error.message}`);
  }
}

debugContainerCreation().catch(console.error);