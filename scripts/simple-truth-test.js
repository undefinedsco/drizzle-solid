#!/usr/bin/env node

/**
 * 最简单的真相测试
 */

async function simpleTruthTest() {
  console.log('🔍 最简单的真相测试');
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
    
    // 1. 记录插入前的完整内容
    console.log('\n📄 插入前的完整内容...');
    const beforeResponse = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (!beforeResponse.ok) {
      throw new Error(`Failed to read resource: ${beforeResponse.status}`);
    }
    
    const beforeContent = await beforeResponse.text();
    console.log(`📊 插入前内容长度: ${beforeContent.length} 字符`);
    console.log(`📊 插入前行数: ${beforeContent.split('\n').length}`);
    
    // 2. 插入一个极其简单的测试
    const uniqueId = `SIMPLE_TEST_${Date.now()}`;
    const uniqueTitle = `简单测试_${Date.now()}`;
    
    console.log(`\n📝 插入测试: ${uniqueId}`);
    console.log(`📝 测试标题: ${uniqueTitle}`);
    
    const simpleSparql = `INSERT DATA { <tasks/#${uniqueId}> <http://purl.org/dc/terms/title> "${uniqueTitle}" . }`;
    
    console.log('\n📤 SPARQL 查询:');
    console.log(simpleSparql);
    
    const insertResponse = await session.fetch(resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: simpleSparql
    });
    
    console.log(`\n📤 INSERT 响应: ${insertResponse.status}`);
    
    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      console.log(`❌ INSERT 失败: ${errorText}`);
      return;
    }
    
    console.log('✅ INSERT 请求返回成功');
    
    // 3. 立即读取插入后的内容
    console.log('\n📄 插入后的完整内容...');
    const afterResponse = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (!afterResponse.ok) {
      throw new Error(`Failed to read resource after insert: ${afterResponse.status}`);
    }
    
    const afterContent = await afterResponse.text();
    console.log(`📊 插入后内容长度: ${afterContent.length} 字符`);
    console.log(`📊 插入后行数: ${afterContent.split('\n').length}`);
    
    // 4. 比较内容变化
    const lengthDiff = afterContent.length - beforeContent.length;
    const lineDiff = afterContent.split('\n').length - beforeContent.split('\n').length;
    
    console.log(`\n📊 内容变化:`);
    console.log(`   字符数变化: ${lengthDiff > 0 ? '+' : ''}${lengthDiff}`);
    console.log(`   行数变化: ${lineDiff > 0 ? '+' : ''}${lineDiff}`);
    
    // 5. 直接搜索我们插入的内容
    const hasUniqueId = afterContent.includes(uniqueId);
    const hasUniqueTitle = afterContent.includes(uniqueTitle);
    
    console.log(`\n🔍 搜索结果:`);
    console.log(`   包含ID "${uniqueId}": ${hasUniqueId ? '✅' : '❌'}`);
    console.log(`   包含标题 "${uniqueTitle}": ${hasUniqueTitle ? '✅' : '❌'}`);
    
    // 6. 如果内容有变化但找不到我们的数据，显示差异
    if (lengthDiff > 0 && !hasUniqueId && !hasUniqueTitle) {
      console.log('\n🚨 奇怪！内容增加了但找不到我们的数据');
      console.log('\n📄 新增的内容可能是:');
      
      // 简单的差异检测
      const beforeLines = beforeContent.split('\n');
      const afterLines = afterContent.split('\n');
      
      if (afterLines.length > beforeLines.length) {
        const newLines = afterLines.slice(beforeLines.length);
        newLines.forEach((line, index) => {
          console.log(`   新行 ${index + 1}: ${line}`);
        });
      }
    }
    
    // 7. 最终判断
    console.log('\n🎯 最终判断:');
    if (hasUniqueId && hasUniqueTitle) {
      console.log('✅ SPARQL INSERT 完全成功！');
      console.log('✅ Solid Pod 原生支持 SPARQL！');
    } else if (lengthDiff > 0) {
      console.log('⚠️  SPARQL INSERT 部分成功（内容有变化但格式可能不对）');
      console.log('🔍 需要进一步分析数据格式');
    } else {
      console.log('❌ SPARQL INSERT 完全失败！');
      console.log('❌ 虽然返回成功状态码，但实际没有插入任何数据');
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 测试失败: ${error.message}`);
    console.error(error);
  }
}

simpleTruthTest().catch(console.error);