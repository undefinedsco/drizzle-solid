#!/usr/bin/env node

/**
 * 检查确切的差异
 */

async function checkExactDiff() {
  console.log('🔍 检查确切的差异');
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
    
    // 读取当前内容
    const response = await session.fetch(resourceUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to read resource: ${response.status}`);
    }
    
    const content = await response.text();
    
    // 显示最后10行的完整内容
    console.log('📄 最后10行的完整内容:');
    const lines = content.split('\n');
    const lastLines = lines.slice(-10);
    
    lastLines.forEach((line, index) => {
      const lineNumber = lines.length - 10 + index + 1;
      console.log(`${lineNumber.toString().padStart(3)}: "${line}"`);
    });
    
    // 查找所有不完整的行
    console.log('\n🔍 查找不完整或异常的行:');
    const suspiciousLines = lines.filter(line => {
      return line.includes('tit') && !line.includes('title') && line.length < 50;
    });
    
    if (suspiciousLines.length > 0) {
      console.log('🚨 找到可疑的行:');
      suspiciousLines.forEach((line, index) => {
        console.log(`   ${index + 1}: "${line}"`);
        console.log(`       长度: ${line.length} 字符`);
      });
    }
    
    // 查找包含 "SIMPLE_TEST" 的任何内容
    console.log('\n🔍 查找包含 "SIMPLE_TEST" 的内容:');
    const simpleTestLines = lines.filter(line => line.includes('SIMPLE_TEST'));
    if (simpleTestLines.length > 0) {
      simpleTestLines.forEach((line, index) => {
        console.log(`   ${index + 1}: "${line}"`);
      });
    } else {
      console.log('   ❌ 没有找到包含 "SIMPLE_TEST" 的行');
    }
    
    // 查找包含 "简单测试" 的内容
    console.log('\n🔍 查找包含 "简单测试" 的内容:');
    const chineseTestLines = lines.filter(line => line.includes('简单测试'));
    if (chineseTestLines.length > 0) {
      chineseTestLines.forEach((line, index) => {
        console.log(`   ${index + 1}: "${line}"`);
      });
    } else {
      console.log('   ❌ 没有找到包含 "简单测试" 的行');
    }
    
    // 分析最后一行
    const lastLine = lines[lines.length - 1];
    const secondLastLine = lines[lines.length - 2];
    
    console.log('\n📄 最后两行详细分析:');
    console.log(`倒数第2行: "${secondLastLine}"`);
    console.log(`   长度: ${secondLastLine.length} 字符`);
    console.log(`最后一行: "${lastLine}"`);
    console.log(`   长度: ${lastLine.length} 字符`);
    console.log(`   是否为空: ${lastLine.trim() === ''}`);
    
    // 现在尝试一个更简单的 INSERT
    console.log('\n🧪 尝试更简单的 INSERT...');
    const simpleId = `TEST_${Date.now()}`;
    const simplestSparql = `INSERT DATA { <#${simpleId}> <http://example.org/test> "value" . }`;
    
    console.log(`📝 最简单的 SPARQL: ${simplestSparql}`);
    
    const beforeLength = content.length;
    
    const insertResponse = await session.fetch(resourceUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/sparql-update'
      },
      body: simplestSparql
    });
    
    console.log(`📤 INSERT 响应: ${insertResponse.status}`);
    
    if (insertResponse.ok) {
      // 立即检查变化
      const afterResponse = await session.fetch(resourceUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });
      
      if (afterResponse.ok) {
        const afterContent = await afterResponse.text();
        const afterLength = afterContent.length;
        const lengthDiff = afterLength - beforeLength;
        
        console.log(`📊 内容长度变化: ${lengthDiff > 0 ? '+' : ''}${lengthDiff}`);
        
        if (lengthDiff > 0) {
          console.log('✅ 内容确实增加了');
          
          // 显示新的最后几行
          const newLines = afterContent.split('\n');
          const newLastLines = newLines.slice(-5);
          
          console.log('\n📄 新的最后5行:');
          newLastLines.forEach((line, index) => {
            const lineNumber = newLines.length - 5 + index + 1;
            console.log(`${lineNumber.toString().padStart(3)}: "${line}"`);
          });
          
          // 搜索我们的测试ID
          const hasTestId = afterContent.includes(simpleId);
          console.log(`🔍 包含测试ID "${simpleId}": ${hasTestId ? '✅' : '❌'}`);
          
          if (hasTestId) {
            console.log('\n🎉 找到了！SPARQL INSERT 确实工作！');
            
            // 找到包含测试ID的行
            const testIdLines = newLines.filter(line => line.includes(simpleId));
            console.log('\n📄 包含测试ID的行:');
            testIdLines.forEach((line, index) => {
              console.log(`   ${index + 1}: "${line}"`);
            });
          }
        }
      }
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 检查失败: ${error.message}`);
    console.error(error);
  }
}

checkExactDiff().catch(console.error);