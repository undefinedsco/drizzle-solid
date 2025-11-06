#!/usr/bin/env node

/**
 * 调试 SPARQL 语法问题
 */

async function debugSparqlSyntax() {
  console.log('🐛 调试 SPARQL 语法问题');
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
    
    // 1. 先读取现有数据，分析其格式
    console.log('\n📄 分析现有数据格式...');
    const response = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (response.ok) {
      const content = await response.text();
      console.log('📋 现有数据片段:');
      const lines = content.split('\n');
      const sampleLines = lines.slice(0, 20);
      sampleLines.forEach((line, index) => {
        if (line.trim()) {
          console.log(`   ${(index + 1).toString().padStart(2)}: ${line}`);
        }
      });
      
      // 2. 尝试不同的 SPARQL 语法
      const testCases = [
        {
          name: '标准 INSERT DATA',
          sparql: `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT DATA {
  <tasks/#task-syntax-test-1> 
    rdf:type <http://example.org/Task> ;
    dc:title "语法测试1" .
}`
        },
        {
          name: '简化版本',
          sparql: `
INSERT DATA {
  <tasks/#task-syntax-test-2> 
    <http://purl.org/dc/terms/title> "语法测试2" .
}`
        },
        {
          name: '模仿现有格式',
          sparql: `
@prefix dc: <http://purl.org/dc/terms/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

INSERT DATA {
  <tasks/#task-syntax-test-3> a <http://example.org/Task>;
    dc:title "语法测试3";
    dc:description "模仿现有格式";
    <http://www.w3.org/2002/07/owl#status> "todo";
    <http://example.org/priority> 1;
    dc:created "2025-09-15T16:25:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
}`
        },
        {
          name: '使用 INSERT 而不是 INSERT DATA',
          sparql: `
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT {
  <tasks/#task-syntax-test-4> 
    rdf:type <http://example.org/Task> ;
    dc:title "语法测试4" .
} WHERE {}`
        }
      ];
      
      for (const testCase of testCases) {
        console.log(`\n🧪 测试: ${testCase.name}`);
        console.log('-----------------------------------');
        console.log(testCase.sparql);
        console.log('-----------------------------------');
        
        const testResponse = await session.fetch(resourceUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/sparql-update'
          },
          body: testCase.sparql
        });
        
        console.log(`📤 响应状态: ${testResponse.status}`);
        
        if (!testResponse.ok) {
          const errorText = await testResponse.text();
          console.log(`❌ 错误信息: ${errorText.substring(0, 200)}...`);
        } else {
          console.log('✅ 请求成功');
          
          // 立即验证是否真的插入了
          const verifyResponse = await session.fetch(resourceUrl, {
            method: 'GET',
            headers: {
              'Accept': 'text/turtle'
            }
          });
          
          if (verifyResponse.ok) {
            const newContent = await verifyResponse.text();
            const taskId = testCase.sparql.match(/task-syntax-test-(\d+)/)?.[0];
            const hasTask = taskId && newContent.includes(taskId);
            const hasTitle = newContent.includes(`语法测试${testCase.sparql.match(/task-syntax-test-(\d+)/)?.[1]}`);
            
            console.log(`📋 任务插入: ${hasTask ? '✅' : '❌'}`);
            console.log(`📋 标题插入: ${hasTitle ? '✅' : '❌'}`);
            
            if (hasTask && hasTitle) {
              console.log(`🎉 ${testCase.name} 成功！`);
              break; // 找到工作的语法就停止
            }
          }
        }
        
        // 等待一下，避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 3. 检查是否有权限问题
      console.log('\n🔐 检查权限...');
      
      // 尝试读取 ACL
      const aclResponse = await session.fetch(resourceUrl + '.acl', {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });
      
      console.log(`📋 ACL 文件状态: ${aclResponse.status}`);
      
      if (aclResponse.ok) {
        const aclContent = await aclResponse.text();
        console.log('📋 ACL 内容:');
        console.log(aclContent.substring(0, 500) + '...');
      }
      
      // 4. 尝试创建一个新的资源文件
      console.log('\n📝 尝试创建新资源文件...');
      
      const newResourceUrl = 'http://localhost:3000/alice/test-resource.ttl';
      const simpleContent = `
@prefix dc: <http://purl.org/dc/terms/> .

<#test> dc:title "测试资源" .
`;
      
      const createResponse = await session.fetch(newResourceUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle'
        },
        body: simpleContent
      });
      
      console.log(`📤 创建资源响应: ${createResponse.status}`);
      
      if (createResponse.ok) {
        console.log('✅ 创建资源成功');
        
        // 验证创建的资源
        const verifyNewResponse = await session.fetch(newResourceUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/turtle'
          }
        });
        
        if (verifyNewResponse.ok) {
          const newResourceContent = await verifyNewResponse.text();
          console.log('📋 新资源内容:');
          console.log(newResourceContent);
          
          // 现在尝试对新资源执行 SPARQL UPDATE
          console.log('\n🧪 对新资源执行 SPARQL UPDATE...');
          
          const updateSparql = `
PREFIX dc: <http://purl.org/dc/terms/>

INSERT DATA {
  <#test2> dc:title "通过SPARQL添加的测试" .
}`;
          
          const updateResponse = await session.fetch(newResourceUrl, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/sparql-update'
            },
            body: updateSparql
          });
          
          console.log(`📤 SPARQL UPDATE 响应: ${updateResponse.status}`);
          
          if (updateResponse.ok) {
            console.log('✅ SPARQL UPDATE 成功');
            
            // 验证更新
            const verifyUpdateResponse = await session.fetch(newResourceUrl, {
              method: 'GET',
              headers: {
                'Accept': 'text/turtle'
              }
            });
            
            if (verifyUpdateResponse.ok) {
              const updatedContent = await verifyUpdateResponse.text();
              const hasUpdate = updatedContent.includes('通过SPARQL添加的测试');
              console.log(`📋 SPARQL UPDATE 生效: ${hasUpdate ? '✅' : '❌'}`);
              
              if (hasUpdate) {
                console.log('\n🎉 SPARQL UPDATE 在新资源上工作正常！');
                console.log('💡 问题可能是 tasks 文件的特殊性质或权限');
              }
              
              console.log('\n📋 更新后的内容:');
              console.log(updatedContent);
            }
          } else {
            const updateError = await updateResponse.text();
            console.log(`❌ SPARQL UPDATE 失败: ${updateError.substring(0, 200)}...`);
          }
        }
      } else {
        const createError = await createResponse.text();
        console.log(`❌ 创建资源失败: ${createError.substring(0, 200)}...`);
      }
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 调试失败: ${error.message}`);
  }
  
  console.log('\n🎯 调试结论:');
  console.log('1. 测试不同的 SPARQL 语法');
  console.log('2. 检查权限和 ACL');
  console.log('3. 测试新资源的 SPARQL UPDATE');
  console.log('4. 确定问题是语法、权限还是资源特性');
}

debugSparqlSyntax().catch(console.error);