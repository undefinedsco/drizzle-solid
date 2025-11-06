#!/usr/bin/env node

/**
 * 检查最新插入的数据
 */

async function examineLatestData() {
  console.log('🔍 检查最新插入的数据');
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
    
    // 读取完整内容
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
    
    // 分析内容
    console.log('📄 完整内容分析:');
    console.log(`📊 总字符数: ${content.length}`);
    
    const lines = content.split('\n');
    console.log(`📊 总行数: ${lines.length}`);
    
    // 查找包含 999 的行
    console.log('\n🔍 包含优先级999的行:');
    const priority999Lines = lines.filter(line => line.includes('999'));
    priority999Lines.forEach((line, index) => {
      console.log(`   ${index + 1}: ${line.trim()}`);
    });
    
    // 查找最近的时间戳
    console.log('\n🕒 查找最近的时间戳:');
    const timestampPattern = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/g;
    const timestamps = content.match(timestampPattern) || [];
    
    // 按时间排序，找到最新的
    const sortedTimestamps = timestamps.sort().reverse();
    console.log('📅 最新的5个时间戳:');
    sortedTimestamps.slice(0, 5).forEach((timestamp, index) => {
      console.log(`   ${index + 1}: ${timestamp}`);
    });
    
    if (sortedTimestamps.length > 0) {
      const latestTimestamp = sortedTimestamps[0];
      console.log(`\n🎯 最新时间戳: ${latestTimestamp}`);
      
      // 查找包含最新时间戳的行及其上下文
      console.log('\n📄 包含最新时间戳的上下文:');
      lines.forEach((line, index) => {
        if (line.includes(latestTimestamp)) {
          console.log(`\n--- 第 ${index + 1} 行附近的上下文 ---`);
          const start = Math.max(0, index - 5);
          const end = Math.min(lines.length, index + 6);
          
          for (let i = start; i < end; i++) {
            const marker = i === index ? '>>> ' : '    ';
            console.log(`${marker}${(i + 1).toString().padStart(3)}: ${lines[i]}`);
          }
        }
      });
    }
    
    // 查找所有任务的开始行
    console.log('\n📋 所有任务的开始行:');
    const taskStartLines = lines.filter(line => line.includes('> a <http://example.org/Task>'));
    console.log(`📊 找到 ${taskStartLines.length} 个任务`);
    
    // 显示最后几个任务
    console.log('\n📄 最后5个任务的开始行:');
    taskStartLines.slice(-5).forEach((line, index) => {
      console.log(`   ${index + 1}: ${line.trim()}`);
    });
    
    // 查找包含 "final-verification" 的行
    console.log('\n🔍 查找包含 "final-verification" 的行:');
    const finalVerificationLines = lines.filter(line => line.includes('final-verification'));
    if (finalVerificationLines.length > 0) {
      finalVerificationLines.forEach((line, index) => {
        console.log(`   ${index + 1}: ${line.trim()}`);
      });
    } else {
      console.log('   ❌ 没有找到包含 "final-verification" 的行');
    }
    
    // 查找包含 "最终验证" 的行
    console.log('\n🔍 查找包含 "最终验证" 的行:');
    const chineseVerificationLines = lines.filter(line => line.includes('最终验证'));
    if (chineseVerificationLines.length > 0) {
      chineseVerificationLines.forEach((line, index) => {
        console.log(`   ${index + 1}: ${line.trim()}`);
      });
    } else {
      console.log('   ❌ 没有找到包含 "最终验证" 的行');
    }
    
    // 分析文件的结构
    console.log('\n📊 文件结构分析:');
    const subjectLines = lines.filter(line => line.match(/^<[^>]+>/));
    console.log(`📋 主体行数: ${subjectLines.length}`);
    
    const propertyLines = lines.filter(line => line.match(/^\s+<[^>]+>/));
    console.log(`📋 属性行数: ${propertyLines.length}`);
    
    // 显示文件的最后20行
    console.log('\n📄 文件的最后20行:');
    const lastLines = lines.slice(-20);
    lastLines.forEach((line, index) => {
      const lineNumber = lines.length - 20 + index + 1;
      console.log(`   ${lineNumber.toString().padStart(3)}: ${line}`);
    });
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 检查失败: ${error.message}`);
    console.error(error);
  }
}

examineLatestData().catch(console.error);