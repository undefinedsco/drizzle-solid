#!/usr/bin/env node

/**
 * 调试 INSERT 问题
 * 找出为什么显示成功但实际失败
 */

async function debugInsertIssue() {
  console.log('🐛 调试 INSERT 问题');
  console.log('================================\n');
  
  const { Session } = await import('@inrupt/solid-client-authn-node');
  
  // 设置认证
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
    console.log(`🌐 WebID: ${session.info.webId}`);
    
    const containerUrl = 'http://localhost:3000/alice/tasks/';
    
    // 1. 检查容器是否存在
    console.log('\n1️⃣ 检查容器是否存在...');
    try {
      const checkResponse = await session.fetch(containerUrl, {
        method: 'HEAD'
      });
      console.log(`   容器检查响应: ${checkResponse.status}`);
      
      if (checkResponse.status === 404) {
        console.log('   ❌ 容器不存在，需要先创建');
        
        // 2. 尝试创建容器
        console.log('\n2️⃣ 尝试创建容器...');
        const createResponse = await session.fetch(containerUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/turtle'
          },
          body: `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<> a ldp:Container .`
        });
        
        console.log(`   容器创建响应: ${createResponse.status}`);
        if (createResponse.ok) {
          console.log('   ✅ 容器创建成功');
        } else {
          const errorText = await createResponse.text();
          console.log(`   ❌ 容器创建失败: ${errorText.substring(0, 200)}...`);
        }
      } else if (checkResponse.ok) {
        console.log('   ✅ 容器已存在');
      }
    } catch (error) {
      console.log(`   ❌ 容器检查失败: ${error.message}`);
    }
    
    // 3. 尝试简单的 INSERT
    console.log('\n3️⃣ 尝试简单的 INSERT...');
    const insertQuery = `
PREFIX dc: <http://purl.org/dc/terms/>
INSERT DATA {
  <${containerUrl}#debug-task> 
    dc:title "Debug Task" ;
    dc:description "Testing INSERT operation" .
}`;
    
    try {
      const insertResponse = await session.fetch(containerUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: insertQuery
      });
      
      console.log(`   INSERT 响应: ${insertResponse.status}`);
      
      if (insertResponse.ok) {
        console.log('   ✅ INSERT 请求成功');
        
        // 4. 立即验证数据
        console.log('\n4️⃣ 立即验证数据...');
        const verifyResponse = await session.fetch(containerUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/turtle'
          }
        });
        
        console.log(`   验证响应: ${verifyResponse.status}`);
        
        if (verifyResponse.ok) {
          const content = await verifyResponse.text();
          const hasDebugTask = content.includes('debug-task');
          const hasTitle = content.includes('Debug Task');
          
          console.log(`   📋 包含调试任务: ${hasDebugTask ? '✅' : '❌'}`);
          console.log(`   📋 包含标题: ${hasTitle ? '✅' : '❌'}`);
          
          if (hasDebugTask && hasTitle) {
            console.log('   🎉 INSERT 真正成功了！');
          } else {
            console.log('   ❌ INSERT 假成功 - 数据没有真正插入');
            console.log('\n   📄 实际内容:');
            console.log('   -----------------------------------');
            console.log(content);
            console.log('   -----------------------------------');
          }
        } else {
          console.log(`   ❌ 验证失败: ${verifyResponse.status}`);
        }
        
      } else {
        const errorText = await insertResponse.text();
        console.log(`   ❌ INSERT 失败: ${errorText.substring(0, 200)}...`);
      }
      
    } catch (error) {
      console.log(`   ❌ INSERT 错误: ${error.message}`);
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 调试失败: ${error.message}`);
  }
  
  console.log('\n🎯 结论:');
  console.log('如果 INSERT 请求返回成功但数据验证失败，');
  console.log('说明 drizzle-solid 的错误处理有问题，');
  console.log('它没有正确检查实际的插入结果。');
}

debugInsertIssue().catch(console.error);