#!/usr/bin/env node

/**
 * 带认证检查容器状态
 */

async function checkWithAuth() {
  console.log('🔍 带认证检查容器状态');
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
    
    // 检查 alice 根目录
    console.log('\n🔍 检查 alice 根目录...');
    const aliceResponse = await session.fetch('http://localhost:3000/alice/', {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    console.log(`📤 Alice 根目录: ${aliceResponse.status}`);
    if (aliceResponse.ok) {
      const content = await aliceResponse.text();
      console.log('📄 内容预览:');
      console.log(content.substring(0, 300) + '...');
      
      // 检查是否包含 tasks
      const hasTasks = content.includes('tasks');
      console.log(`📋 包含 'tasks': ${hasTasks ? '✅' : '❌'}`);
    }
    
    // 检查 tasks 容器
    console.log('\n🔍 检查 tasks 容器...');
    const tasksResponse = await session.fetch('http://localhost:3000/alice/tasks/', {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    console.log(`📤 Tasks 容器: ${tasksResponse.status}`);
    if (tasksResponse.ok) {
      const content = await tasksResponse.text();
      console.log('✅ Tasks 容器存在！');
      console.log('📄 内容:');
      console.log(content);
    } else {
      const errorText = await tasksResponse.text();
      console.log(`❌ Tasks 容器不存在: ${errorText.substring(0, 200)}...`);
      
      // 尝试创建 tasks 容器
      console.log('\n📁 尝试创建 tasks 容器...');
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
      
      console.log(`📤 创建容器: ${createResponse.status}`);
      if (createResponse.ok) {
        console.log('✅ 容器创建成功！');
        
        // 再次检查
        const recheckResponse = await session.fetch('http://localhost:3000/alice/tasks/', {
          method: 'GET',
          headers: {
            'Accept': 'text/turtle'
          }
        });
        
        console.log(`📤 重新检查: ${recheckResponse.status}`);
        if (recheckResponse.ok) {
          console.log('✅ 容器现在可以访问了！');
        }
      } else {
        const createErrorText = await createResponse.text();
        console.log(`❌ 创建失败: ${createErrorText.substring(0, 200)}...`);
      }
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 检查失败: ${error.message}`);
  }
}

checkWithAuth().catch(console.error);