#!/usr/bin/env ts-node

/**
 * Drizzle Solid 示例: Solid身份认证
 * 
 * 这个示例展示如何：
 * 1. 使用Credential Tokens进行Solid身份验证
 * 2. 建立认证会话(Session)
 * 3. 验证认证权限（通过读取Profile数据）
 * 4. 展示完整的认证流程
 * 
 * 认证方式参考：
 * https://docs.inrupt.com/guides/authentication-in-solid/authentication-single-user-application
 * 
 * 前置条件：
 * - 已完成示例1的设置
 * - 拥有有效的Client ID和Client Secret
 * - Community Solid Server正在运行
 * 
 * 技术特点：
 * - 标准的Client Credentials认证
 * - 类型安全的数据访问
 * - SPARQL查询展示
 * - 实际Pod数据操作
 */

import { Session } from '@inrupt/solid-client-authn-node';
import { drizzle } from '../src/index';
import { podTable, string, int } from '../src/index';
import * as readline from 'readline';

// 创建readline接口用于用户输入
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 辅助函数：获取用户输入
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// 定义Profile表结构
const profileTable = podTable('profile', {
  id: string('id').primaryKey().predicate('http://xmlns.com/foaf/0.1/identifier'),
  name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
  email: string('email').predicate('http://xmlns.com/foaf/0.1/mbox'),
  bio: string('bio').predicate('http://purl.org/dc/terms/description'),
  location: string('location').predicate('http://www.w3.org/2006/vcard/ns#locality'),
  age: int('age').predicate('http://xmlns.com/foaf/0.1/age')
}, {
  base: '/profile/card#me',
  type: 'http://xmlns.com/foaf/0.1/Person'
});

/**
 * 使用Credential Tokens进行Node.js认证
 * 根据Inrupt官方文档实现，使用真正的Client Credentials流程
 */
async function createNodeSession(
  clientId: string,
  clientSecret: string,
  oidcIssuer: string
): Promise<Session> {
  const session = new Session();
  
  try {
    console.log('   🔄 执行Client Credentials认证...');
    
    // 使用Inrupt官方推荐的Client Credentials认证
    await session.login({
      clientId: clientId,
      clientSecret: clientSecret,
      oidcIssuer: oidcIssuer,
      tokenType: 'DPoP'
    });
    
    if (!session.info.isLoggedIn) {
      throw new Error('认证失败：Session未处于登录状态');
    }
    
    console.log('   ✅ Client Credentials认证成功');
    return session;
  } catch (error) {
    throw new Error(`Session创建失败: ${error}`);
  }
}

/**
 * 验证认证权限（通过读取Profile数据）
 */
async function verifyAuthentication(session: Session) {
  console.log('\n🔍 验证认证权限');
  console.log('============================================================');
  
  try {
    console.log('   ✅ 使用已认证的Session');
    console.log(`   🆔 Session WebID: ${session.info.webId || 'N/A'}`);
    console.log(`   🔑 Session状态: ${session.info.isLoggedIn ? '已认证' : '未认证'}`);
    
    // 创建drizzle-solid连接
    console.log('   🔄 创建drizzle-solid数据库连接...');
    const db = drizzle(session);
    console.log('   ✅ 数据库连接创建成功');
    
    // 展示即将执行的SPARQL查询
    console.log('\n🔍 SPARQL查询预览');
    console.log('============================================================');
    console.log('drizzle-solid将生成类似以下的SPARQL查询：');
    console.log('');
    console.log('SELECT ?id ?name ?email ?bio ?location ?age');
    console.log('WHERE {');
    console.log('  ?subject a <http://xmlns.com/foaf/0.1/Person> .');
    console.log('  ?subject <http://xmlns.com/foaf/0.1/name> ?name .');
    console.log('  OPTIONAL { ?subject <http://xmlns.com/foaf/0.1/mbox> ?email }');
    console.log('  OPTIONAL { ?subject <http://purl.org/dc/terms/description> ?bio }');
    console.log('  OPTIONAL { ?subject <http://www.w3.org/2006/vcard/ns#locality> ?location }');
    console.log('  OPTIONAL { ?subject <http://xmlns.com/foaf/0.1/age> ?age }');
    console.log('}');
    
    // 执行查询
    console.log('\n🔄 执行Profile数据查询...');
    const profiles = await db.select().from(profileTable);
    
    console.log(`📊 找到 ${profiles.length} 条Profile记录`);
    
    if (profiles.length > 0) {
      console.log('\n📋 Profile数据：');
      profiles.forEach((profile, index) => {
        console.log(`\n   ${index + 1}. Profile记录：`);
        console.log(`      🆔 ID: ${profile.id || 'N/A'}`);
        console.log(`      👤 姓名: ${profile.name || 'N/A'}`);
        console.log(`      📧 邮箱: ${profile.email || 'N/A'}`);
        console.log(`      📝 简介: ${profile.bio || 'N/A'}`);
        console.log(`      📍 位置: ${profile.location || 'N/A'}`);
        console.log(`      🎂 年龄: ${profile.age || 'N/A'}`);
      });
    } else {
      console.log('\n💡 没有找到Profile数据');
      console.log('   这可能是因为：');
      console.log('   • Pod是新创建的，还没有Profile数据');
      console.log('   • Profile数据存储在不同的位置');
      console.log('   • 需要先添加一些Profile数据');
    }
    
  } catch (error) {
    console.error('❌ Profile数据读取失败:', error);
    throw error;
  }
}

/**
 * 展示Node.js Session认证的官方文档和技术细节
 */
function showAuthenticationDetails() {
  console.log('\n🔍 Node.js Session认证详解');
  console.log('============================================================');
  console.log('');
  console.log('📚 官方文档参考：');
  console.log('   https://docs.inrupt.com/guides/authentication-in-solid/authentication-single-user-application');
  console.log('');
  console.log('📋 认证架构：');
  console.log('   Credential Tokens ──→ Client Credentials ──→ Node.js Session ──→ drizzle-solid ──→ SPARQL ──→ Solid Pod');
  console.log('');
  console.log('🔐 标准认证流程：');
  console.log('   1. 在Solid服务器上创建Credential Tokens');
  console.log('   2. 获取Client ID和Client Secret');
  console.log('   3. 调用 session.login() 进行OIDC认证');
  console.log('   4. 验证认证状态 (session.info.isLoggedIn)');
  console.log('   5. 使用认证后的Session进行数据操作');
  console.log('');
  console.log('🔑 Credential Tokens优势：');
  console.log('   • 标准的OIDC Client Credentials流程');
  console.log('   • 生产级的安全认证');
  console.log('   • 支持权限范围控制');
  console.log('   • 可撤销和管理');
  console.log('   • 适合服务器端应用');
  console.log('');
  console.log('🗃️ 数据查询流程：');
  console.log('   1. TypeScript查询语法');
  console.log('      const profiles = await db.select().from(profileTable);');
  console.log('');
  console.log('   2. drizzle-solid转换为SPARQL：');
  console.log('      SELECT ?id ?name ?email ?bio ?location ?age');
  console.log('      WHERE {');
  console.log('        ?subject a <http://xmlns.com/foaf/0.1/Person> .');
  console.log('        ?subject <http://xmlns.com/foaf/0.1/name> ?name .');
  console.log('        OPTIONAL { ?subject <http://xmlns.com/foaf/0.1/mbox> ?email }');
  console.log('        OPTIONAL { ?subject <http://purl.org/dc/terms/description> ?bio }');
  console.log('        OPTIONAL { ?subject <http://www.w3.org/2006/vcard/ns#locality> ?location }');
  console.log('        OPTIONAL { ?subject <http://xmlns.com/foaf/0.1/age> ?age }');
  console.log('      }');
  console.log('');
  console.log('   3. 使用Session.fetch执行认证HTTP请求');
  console.log('   4. 解析RDF响应数据');
  console.log('   5. 映射为TypeScript对象');
  console.log('');
  console.log('💡 关键优势：');
  console.log('   ✅ 遵循Inrupt官方标准');
  console.log('   ✅ 生产级安全认证');
  console.log('   ✅ 类型安全的数据访问');
  console.log('   ✅ 自动SPARQL查询生成');
  console.log('   ✅ 标准化的认证流程');
  console.log('   ✅ 完整的错误处理');
}

/**
 * 展示高级查询示例
 */
async function showAdvancedQueryExamples(session: Session) {
  console.log('\n🚀 高级查询示例');
  console.log('============================================================');
  
  console.log('💡 以下是一些高级查询的示例代码：');
  console.log('');
  console.log('1. 条件查询：');
  console.log('   const beijingUsers = await db.select()');
  console.log('     .from(profileTable)');
  console.log('     .where({ location: "Beijing, China" });');
  console.log('');
  console.log('2. 字段选择：');
  console.log('   const names = await db.select({ name: profileTable.name })');
  console.log('     .from(profileTable);');
  console.log('');
  console.log('3. 排序查询：');
  console.log('   const sortedProfiles = await db.select()');
  console.log('     .from(profileTable)');
  console.log('     .orderBy(profileTable.name);');
  console.log('');
  console.log('4. 限制结果：');
  console.log('   const firstFive = await db.select()');
  console.log('     .from(profileTable)');
  console.log('     .limit(5);');
  console.log('');
  console.log('🔍 这些查询都会被自动转换为相应的SPARQL查询！');
}

// 主函数
async function main() {
  console.log('🚀 Drizzle Solid 示例: Solid身份认证');
  console.log('============================================================');
  console.log('📚 认证方式参考: https://docs.inrupt.com/guides/authentication-in-solid/authentication-single-user-application');
  console.log('🔑 使用Credential Tokens进行标准OIDC认证');
  console.log('');
  
  try {
    // 1. 配置认证信息
    console.log('🔐 使用Credential Tokens认证');
    console.log('============================================================');
    
    // 交互式获取认证信息
    console.log('请输入您的Solid认证信息：');
    console.log('💡 如果您还没有创建Credential Tokens，请先运行: yarn example:setup\n');
    
    const clientId = await askQuestion('Client ID: ');
    const clientSecret = await askQuestion('Client Secret: ');
    const oidcIssuer = await askQuestion('OIDC Issuer (默认: http://localhost:3000): ') || 'http://localhost:3000';
    
    if (!clientId || !clientSecret) {
      console.log('❌ Client ID和Client Secret不能为空！');
      rl.close();
      process.exit(1);
    }
    
    console.log(`\n   🔑 Client ID: ${clientId.substring(0, 8)}...`);
    console.log(`   🔗 OIDC提供商: ${oidcIssuer}`);
    
    // 2. 创建认证Session
    console.log('\n🔄 创建认证Session...');
    const session = await createNodeSession(clientId, clientSecret, oidcIssuer);
    
    // 3. 验证Session状态
    console.log('\n✅ Session认证成功');
    console.log(`   🆔 WebID: ${session.info.webId || 'N/A'}`);
    console.log(`   🔑 Session ID: ${session.info.sessionId || 'N/A'}`);
    console.log(`   🎫 认证状态: ${session.info.isLoggedIn ? '已认证' : '未认证'}`);
    
    // 4. 验证认证权限
    await verifyAuthentication(session);
    
    // 5. 展示认证技术细节
    showAuthenticationDetails();
    
    // 6. 展示高级查询示例
    console.log('\n🔄 高级查询示例演示...');
    await showAdvancedQueryExamples(session);
    
    // 7. 完成总结
    console.log('\n🎉 Solid身份认证示例完成！');
    console.log('============================================================');
    console.log('✅ 成功展示的功能：');
    console.log('   • Credential Tokens认证 (标准OIDC流程)');
    console.log('   • Node.js Session建立');
    console.log('   • 认证权限验证');
    console.log('   • drizzle-solid集成');
    console.log('   • 完整的错误处理');
    console.log('');
    console.log('📚 相关资源：');
    console.log('   • Inrupt认证文档: https://docs.inrupt.com/guides/authentication-in-solid/');
    console.log('   • Solid协议规范: https://solidproject.org/TR/protocol');
    console.log('   • drizzle-solid文档: ./docs/');
    console.log('');
    console.log('💡 使用提示：');
    console.log('   • 方式1: 创建.env文件（推荐）');
    console.log('     在项目根目录创建.env文件，内容如下：');
    console.log('     SOLID_CLIENT_ID=your-client-id');
    console.log('     SOLID_CLIENT_SECRET=your-client-secret');
    console.log('     SOLID_OIDC_ISSUER=http://localhost:3000');
    console.log('   • 方式2: 设置环境变量');
    console.log('     export SOLID_CLIENT_ID="your-client-id"');
    console.log('     export SOLID_CLIENT_SECRET="your-client-secret"');
    console.log('     export SOLID_OIDC_ISSUER="http://localhost:3000"');
    console.log('   • 方式3: 直接修改代码中的配置值');
    console.log('   • 确保使用示例1中创建的Credential Tokens');
    console.log('   • 这是标准的生产级OIDC认证流程');
    console.log('   • 查看生成的SPARQL查询了解底层实现');
    console.log('');
    console.log('🔧 .env文件配置说明：');
    console.log('   • 创建.env文件后，后续示例将自动读取配置');
    console.log('   • 无需重复输入认证信息，提高开发效率');
    console.log('   • .env文件已在.gitignore中，不会提交到版本控制');
    console.log('   • 示例3将直接使用.env中的配置进行认证');
    
    // 成功完成，关闭readline并退出
    rl.close();
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ 示例执行失败:', error);
    console.log('\n💡 故障排除：');
    console.log('   • 检查Client ID和Client Secret是否正确');
    console.log('   • 确认Solid服务器是否可访问');
    console.log('   • 验证Credential Tokens是否有效');
    console.log('   • 确保Token具有适当的权限（Read/Write）');
    console.log('   • 如果使用本地服务器，确保已启动: npx @solid/community-server');
    console.log('   • 检查网络连接和防火墙设置');
    console.log('   • 尝试重新创建Credential Tokens');
    console.log('   • 运行示例1确保正确设置: yarn example:setup');
    rl.close();
    process.exit(1);
  } finally {
    rl.close();
  }
}

// 运行示例
if (require.main === module) {
  main().catch(console.error);
}
