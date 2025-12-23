/**
 * 07-hooks-and-profile.ts
 *
 * 展示 Drizzle Solid 的 Hooks 系统和 ProfileManager：
 * 1. 使用 solidSchema 定义纯数据结构（不含 hooks）
 * 2. 使用 db.createTable 绑定位置和 hooks
 * 3. 使用 ProfileManager 管理 Profile 中的资源链接
 * 4. 实现 "发布/取消发布" 模式
 *
 * Schema/Table 分离设计：
 * - Schema（模型层）：只定义数据结构，可复用，不含 hooks
 * - Table（应用层）：通过 db.createTable 创建，hooks 可访问 db 实例
 *
 * 当资源被标记为 `public: true` 时，会自动通过 `foaf:made` 链接到用户的 Profile，
 * 使其可被爬虫和其他应用发现。
 */

import { drizzle, solidSchema, id, string, boolean, ProfileManager, eq } from 'drizzle-solid';
import type { HookContext } from 'drizzle-solid';
import { Session } from '@inrupt/solid-client-authn-node';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

async function getAuthenticatedSession(): Promise<Session> {
  const session = new Session();
  const clientId = process.env.SOLID_CLIENT_ID;
  const clientSecret = process.env.SOLID_CLIENT_SECRET;
  const oidcIssuer = process.env.SOLID_OIDC_ISSUER || 'http://localhost:3000/';

  if (!clientId || !clientSecret) {
    throw new Error('Missing SOLID_CLIENT_ID or SOLID_CLIENT_SECRET');
  }

  await session.login({
    clientId,
    clientSecret,
    oidcIssuer,
    tokenType: 'DPoP'
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Login failed');
  }

  return session;
}

function getPodBaseUrl(session: Session): string {
  if (!session.info.webId) throw new Error('No WebID');
  return session.info.webId.split('profile')[0];
}

// FOAF:made 谓词 - 用于表示"某人创建了某物"
const FOAF_MADE = 'http://xmlns.com/foaf/0.1/made';

/**
 * 定义 agents schema（纯数据结构，不含 hooks）
 * 
 * Schema 是可复用的，可以在不同的应用场景中使用不同的 hooks
 */
const agentsSchema = solidSchema('agents', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
  description: string('description').predicate('https://schema.org/description'),
  public: boolean('public').predicate('https://schema.org/isAccessibleForFree'),
}, {
  type: 'https://schema.org/SoftwareApplication',
  subjectTemplate: '{id}.ttl',
});

async function run(providedSession?: Session) {
  console.log('=== Example 07: Hooks and ProfileManager ===\n');

  // 1. 认证
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  
  console.log('Connected to Pod:', podBase);
  console.log('WebID:', session.info.webId);
  console.log('');

  // 2. 创建数据库连接
  const db = drizzle(session);

  // 3. 使用 db.createTable 创建表，绑定位置和 hooks
  //    hooks 中的 ctx.db 可以访问数据库实例，实现跨表操作
  const agents = db.createTable(agentsSchema, {
    base: `${podBase}data/hooks-example/agents/`,
    hooks: {
      /**
       * afterInsert: 记录插入后触发
       * 
       * @param ctx - 包含 session, table 和 db 的上下文
       * @param record - 刚插入的完整记录（包含 @id）
       */
      afterInsert: async (ctx: HookContext, record: Record<string, unknown>) => {
        console.log(`  [Hook] afterInsert: ${record.name}`);
        
        // ctx.db 可用于跨表操作，例如：
        // await ctx.db.insert(auditLogTable).values({ action: 'agent_created', entityId: record['@id'] });
        
        if (record.public) {
          console.log(`  [Hook] Resource is public, adding to Profile...`);
          const pm = new ProfileManager(ctx.session);
          const resourceUri = record['@id'] as string;
          
          try {
            await pm.addToProfile(FOAF_MADE, resourceUri);
            console.log(`  [Hook] Added to Profile: ${resourceUri}`);
          } catch (error) {
            console.error(`  [Hook] Failed to add to Profile:`, error);
          }
        } else {
          console.log(`  [Hook] Resource is private, skipping Profile update`);
        }
      },

      /**
       * afterUpdate: 记录更新后触发
       * 
       * @param ctx - 包含 session, table 和 db 的上下文
       * @param record - 更新后的完整记录
       * @param changes - 本次更新中变化的字段
       */
      afterUpdate: async (ctx: HookContext, record: Record<string, unknown>, changes: Record<string, unknown>) => {
        console.log(`  [Hook] afterUpdate: ${record.name}`);
        console.log(`  [Hook] Changed fields:`, Object.keys(changes));
        
        // 只有当 'public' 字段发生变化时才更新 Profile
        if ('public' in changes) {
          const pm = new ProfileManager(ctx.session);
          const resourceUri = record['@id'] as string;
          
          if (record.public) {
            console.log(`  [Hook] Resource became public, adding to Profile...`);
            await pm.addToProfile(FOAF_MADE, resourceUri);
          } else {
            console.log(`  [Hook] Resource became private, removing from Profile...`);
            await pm.removeFromProfile(FOAF_MADE, resourceUri);
          }
        }
      },

      /**
       * afterDelete: 记录删除后触发
       * 
       * @param ctx - 包含 session, table 和 db 的上下文
       * @param record - 被删除的记录
       */
      afterDelete: async (ctx: HookContext, record: Record<string, unknown>) => {
        console.log(`  [Hook] afterDelete: ${record.name}`);
        
        // 如果删除的是公开资源，从 Profile 中移除链接
        if (record.public) {
          const pm = new ProfileManager(ctx.session);
          const resourceUri = record['@id'] as string;
          
          console.log(`  [Hook] Removing deleted resource from Profile...`);
          await pm.removeFromProfile(FOAF_MADE, resourceUri);
        }
      },
    },
  });

  // 4. 初始化表
  await db.init([agents]);

  try {
    // ========================================
    // Step 1: 插入一个公开的 agent
    // ========================================
    console.log('--- Step 1: Insert a public agent ---');
    const [publicAgent] = await db.insert(agents).values({
      name: 'Public Assistant',
      description: 'A publicly visible AI assistant',
      public: true,
    });
    console.log(`Inserted: ${publicAgent.name} (id: ${publicAgent.id})`);
    console.log('');

    // ========================================
    // Step 2: 插入一个私有的 agent
    // ========================================
    console.log('--- Step 2: Insert a private agent ---');
    const [privateAgent] = await db.insert(agents).values({
      name: 'Private Helper',
      description: 'A private AI helper',
      public: false,
    });
    console.log(`Inserted: ${privateAgent.name} (id: ${privateAgent.id})`);
    console.log('');

    // ========================================
    // Step 3: 检查 Profile 中的链接
    // ========================================
    console.log('--- Step 3: Check Profile links ---');
    const pm = new ProfileManager(session);
    const publishedResources = await pm.getLinkedResources(FOAF_MADE);
    console.log(`Resources linked via foaf:made: ${publishedResources.length}`);
    for (const uri of publishedResources) {
      console.log(`  - ${uri}`);
    }
    console.log('');

    // ========================================
    // Step 4: 将私有 agent 改为公开
    // ========================================
    console.log('--- Step 4: Make private agent public ---');
    await db.update(agents)
      .set({ public: true })
      .where(eq(agents.id, privateAgent.id));
    console.log('Updated agent to public');
    console.log('');

    // ========================================
    // Step 5: 再次检查 Profile 链接
    // ========================================
    console.log('--- Step 5: Check Profile links after update ---');
    const updatedResources = await pm.getLinkedResources(FOAF_MADE);
    console.log(`Resources linked via foaf:made: ${updatedResources.length}`);
    for (const uri of updatedResources) {
      console.log(`  - ${uri}`);
    }
    console.log('');

    // ========================================
    // Step 6: 将公开 agent 改为私有
    // ========================================
    console.log('--- Step 6: Make public agent private ---');
    await db.update(agents)
      .set({ public: false })
      .where(eq(agents.id, publicAgent.id));
    console.log('Updated agent to private');
    console.log('');

    // ========================================
    // Step 7: 删除一个 agent
    // ========================================
    console.log('--- Step 7: Delete an agent ---');
    // 先把 privateAgent 再改成 public 以测试删除时的 hook
    await db.update(agents)
      .set({ public: true })
      .where(eq(agents.id, privateAgent.id));
    
    await db.delete(agents).where(eq(agents.id, privateAgent.id));
    console.log('Deleted agent');
    console.log('');

    // ========================================
    // Step 8: 最终检查
    // ========================================
    console.log('--- Step 8: Final Profile check ---');
    const finalResources = await pm.getLinkedResources(FOAF_MADE);
    console.log(`Resources linked via foaf:made: ${finalResources.length}`);
    for (const uri of finalResources) {
      console.log(`  - ${uri}`);
    }

  } finally {
    // ========================================
    // Cleanup: 删除所有测试数据
    // ========================================
    console.log('\n--- Cleanup ---');
    const remaining = await db.select().from(agents);
    for (const agent of remaining) {
      await db.delete(agents).where(eq(agents.id, agent.id));
    }
    console.log(`Cleaned up ${remaining.length} remaining agents`);
  }

  console.log('\n=== Example complete ===');
}

// 仅在直接运行时执行
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { run };
