#!/usr/bin/env node

/**
 * 检查真实的数据插入情况
 * 使用认证 Session 来验证
 */

async function checkRealData() {
  console.log('🔍 检查真实的数据插入情况');
  console.log('================================\n');
  
  // 检查环境变量
  const clientId = process.env.SOLID_CLIENT_ID;
  const clientSecret = process.env.SOLID_CLIENT_SECRET;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER || 'http://localhost:3000';
  
  console.log(`Client ID: ${clientId ? clientId.substring(0, 20) + '...' : '未设置'}`);
  console.log(`Client Secret: ${clientSecret ? '已设置' : '未设置'}`);
  console.log(`OIDC Issuer: ${oidcIssuer}`);
  
  if (!clientId || !clientSecret) {
    console.log('\n❌ 认证信息不完整');
    console.log('💡 这解释了为什么 INSERT 看起来成功但实际上可能失败了');
    console.log('');
    console.log('🔧 解决方案:');
    console.log('1. 运行 yarn example:setup 创建 Pod 和 Token');
    console.log('2. 或者设置环境变量:');
    console.log('   export SOLID_CLIENT_ID="your-client-id"');
    console.log('   export SOLID_CLIENT_SECRET="your-client-secret"');
    return;
  }
  
  // 尝试认证并检查数据
  try {
    const { Session } = await import('@inrupt/solid-client-authn-node');
    
    console.log('\n🔐 尝试认证...');
    const session = new Session();
    
    await session.login({
      clientId,
      clientSecret,
      oidcIssuer,
      tokenType: 'Bearer'
    });
    
    if (!session.info.isLoggedIn) {
      throw new Error('认证失败');
    }
    
    console.log('✅ 认证成功');
    console.log(`🌐 WebID: ${session.info.webId}`);
    
    // 构建容器 URL
    const webId = session.info.webId;
    const userPath = webId.split('/').slice(0, -2).join('/').replace('http://localhost:3000', '');
    const containerUrl = `http://localhost:3000${userPath}/tasks/`;
    
    console.log(`\n📁 检查容器: ${containerUrl}`);
    
    // 使用认证的 fetch 获取数据
    const response = await session.fetch(containerUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/turtle'
      }
    });
    
    console.log(`📊 响应状态: ${response.status}`);
    
    if (response.ok) {
      const content = await response.text();
      console.log('✅ 成功获取数据');
      
      console.log('\n📄 容器内容:');
      console.log('-----------------------------------');
      console.log(content);
      console.log('-----------------------------------');
      
      // 分析内容
      const hasTaskData = content.includes('task-');
      const hasRecentTask = content.includes('task-1757951551951');
      const hasTitle = content.includes('dc:title');
      const hasLearningTask = content.includes('学习Drizzle Solid');
      
      console.log('\n🔍 数据分析:');
      console.log(`📋 包含任务数据: ${hasTaskData ? '✅' : '❌'}`);
      console.log(`📋 包含最近任务: ${hasRecentTask ? '✅' : '❌'}`);
      console.log(`📋 包含标题字段: ${hasTitle ? '✅' : '❌'}`);
      console.log(`📋 包含学习任务: ${hasLearningTask ? '✅' : '❌'}`);
      
      if (hasTaskData && hasTitle) {
        console.log('\n🎉 结论: INSERT 操作确实成功了！');
        console.log('💡 之前的 SELECT 失败是 Comunica 的问题，不是数据问题');
      } else if (content.trim().length > 100) {
        console.log('\n⚠️  容器有数据，但不是我们期望的任务数据');
        console.log('💡 可能是其他测试留下的数据');
      } else {
        console.log('\n❌ 容器基本为空，INSERT 可能没有真正成功');
      }
      
    } else {
      const errorText = await response.text();
      console.log(`❌ 获取数据失败: ${response.status}`);
      console.log(`错误信息: ${errorText.substring(0, 200)}...`);
    }
    
    await session.logout();
    
  } catch (error) {
    console.log(`❌ 检查过程失败: ${error.message}`);
  }
}

checkRealData().catch(console.error);