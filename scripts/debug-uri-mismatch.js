#!/usr/bin/env node

/**
 * 调试 URI 不匹配问题
 */

async function debugUriMismatch() {
  console.log('🐛 调试 URI 不匹配问题');
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
    
    const resourceUrl = 'http://localhost:3000/alice/tasks';
    
    // 1. 读取当前内容并分析 URI 格式
    console.log('\n📄 分析当前内容中的 URI 格式...');
    const response = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (response.ok) {
      const content = await response.text();
      
      // 分析现有的 URI 格式
      console.log('🔍 现有任务的 URI 格式:');
      const lines = content.split('\n');
      const taskLines = lines.filter(line => line.includes('task-') && line.includes('a <http://example.org/Task>'));
      
      taskLines.slice(0, 3).forEach((line, index) => {
        console.log(`   ${index + 1}. ${line.trim()}`);
      });
      
      // 检查是否有我们刚插入的任务
      const recentTaskLines = lines.filter(line => line.includes('task-fixed-'));
      console.log(`\n📋 包含 'task-fixed-' 的行数: ${recentTaskLines.length}`);
      
      if (recentTaskLines.length > 0) {
        console.log('🎯 找到最近插入的任务:');
        recentTaskLines.forEach(line => {
          console.log(`   ${line.trim()}`);
        });
      }
      
      // 检查是否有我们的标题
      const titleLines = lines.filter(line => line.includes('修复测试任务'));
      console.log(`\n📋 包含 '修复测试任务' 的行数: ${titleLines.length}`);
      
      if (titleLines.length > 0) {
        console.log('🎯 找到标题行:');
        titleLines.forEach(line => {
          console.log(`   ${line.trim()}`);
        });
      }
      
      // 分析 URI 模式
      console.log('\n🔍 URI 模式分析:');
      const uriPattern1 = content.match(/<tasks\/#[^>]+>/g) || [];
      const uriPattern2 = content.match(/<http:\/\/localhost:3000\/alice\/tasks#[^>]+>/g) || [];
      
      console.log(`   相对URI格式 (<tasks/#...>): ${uriPattern1.length} 个`);
      console.log(`   绝对URI格式 (<http://...#...>): ${uriPattern2.length} 个`);
      
      if (uriPattern1.length > 0) {
        console.log('   相对URI示例:');
        uriPattern1.slice(0, 3).forEach(uri => console.log(`     ${uri}`));
      }
      
      if (uriPattern2.length > 0) {
        console.log('   绝对URI示例:');
        uriPattern2.slice(0, 3).forEach(uri => console.log(`     ${uri}`));
      }
      
      // 2. 现在测试一个简单的 INSERT，使用与现有数据相同的格式
      console.log('\n🧪 测试使用相对URI格式的 INSERT...');
      const testTaskId = `task-debug-relative-${Date.now()}`;
      
      const relativeSparql = `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  <tasks/#${testTaskId}> 
    rdf:type <http://example.org/Task> ;
    dc:title "相对URI测试" ;
    dc:description "使用相对URI格式测试" ;
    <http://www.w3.org/2002/07/owl#status> "todo" ;
    <http://example.org/priority> 999 ;
    dc:created "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
}`;
      
      console.log('📝 相对URI SPARQL:');
      console.log('-----------------------------------');
      console.log(relativeSparql);
      console.log('-----------------------------------');
      
      const relativeResponse = await session.fetch(resourceUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update'
        },
        body: relativeSparql
      });
      
      console.log(`📤 相对URI INSERT 响应: ${relativeResponse.status}`);
      
      if (relativeResponse.ok) {
        console.log('✅ 相对URI INSERT 成功');
        
        // 立即验证
        const verifyResponse = await session.fetch(resourceUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/turtle'
          }
        });
        
        if (verifyResponse.ok) {
          const newContent = await verifyResponse.text();
          const hasRelativeTask = newContent.includes(testTaskId);
          const hasRelativeTitle = newContent.includes('相对URI测试');
          
          console.log(`📋 相对URI任务插入成功: ${hasRelativeTask ? '✅' : '❌'}`);
          console.log(`📋 相对URI标题插入成功: ${hasRelativeTitle ? '✅' : '❌'}`);
          
          if (hasRelativeTask) {
            console.log('\n🎉 相对URI格式是正确的！');
            console.log('💡 问题可能在于 drizzle-solid 生成了绝对URI，但应该使用相对URI');
          }
        }
      } else {
        const errorText = await relativeResponse.text();
        console.log(`❌ 相对URI INSERT 失败: ${errorText.substring(0, 200)}...`);
      }
      
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 调试失败: ${error.message}`);
  }
  
  console.log('\n🎯 调试结论:');
  console.log('1. 检查现有数据使用的URI格式');
  console.log('2. 测试相对URI vs 绝对URI');
  console.log('3. 确定正确的URI格式');
}

debugUriMismatch().catch(console.error);