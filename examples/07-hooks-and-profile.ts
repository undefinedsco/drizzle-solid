/**
 * 07-hooks-and-profile.ts
 *
 * 展示 drizzle-solid 的 Hooks 系统和 ProfileManager：
 * 1. 使用 solidSchema 定义纯数据结构（不含 hooks）
 * 2. 使用 client.bind() 在运行时绑定位置和 hooks
 * 3. 使用 ProfileManager 管理 Profile 中的资源链接
 * 4. 通过 collection/entity API 实现“发布/取消发布”模式
 *
 * Schema/Table 分离设计：
 * - Schema（模型层）：只定义数据结构，可复用，不含 hooks
 * - Table（应用层）：通过 client.bind(...) 绑定实际 Pod 位置与 hooks
 *
 * 当资源被标记为 `public: true` 时，会自动通过 `foaf:made` 链接到用户的 Profile，
 * 使其可被爬虫和其他应用发现。
 */

import { pod, solidSchema, id, string, boolean, ProfileManager } from 'drizzle-solid';
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
    tokenType: 'DPoP',
  });

  if (!session.info.isLoggedIn) {
    throw new Error('Login failed');
  }

  return session;
}

function getPodBaseUrl(session: Session): string {
  if (!session.info.webId) {
    throw new Error('No WebID');
  }
  return session.info.webId.split('profile')[0];
}

const FOAF_MADE = 'http://xmlns.com/foaf/0.1/made';

const agentsSchema = solidSchema({
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

  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);
  const client = pod(session);

  console.log('Connected to Pod:', podBase);
  console.log('WebID:', session.info.webId);
  console.log('');

  const agents = client.bind(agentsSchema, {
    base: `${podBase}data/hooks-example/agents/`,
    hooks: {
      afterInsert: async (ctx: HookContext, record: Record<string, unknown>) => {
        console.log(`  [Hook] afterInsert: ${record.name}`);

        if (record.public) {
          console.log('  [Hook] Resource is public, adding to Profile...');
          const pm = new ProfileManager(ctx.session);
          const resourceUri = record['@id'] as string;

          try {
            await pm.addToProfile(FOAF_MADE, resourceUri);
            console.log(`  [Hook] Added to Profile: ${resourceUri}`);
          } catch (error) {
            console.error('  [Hook] Failed to add to Profile:', error);
          }
        } else {
          console.log('  [Hook] Resource is private, skipping Profile update');
        }
      },
      afterUpdate: async (ctx: HookContext, record: Record<string, unknown>, changes: Record<string, unknown>) => {
        console.log(`  [Hook] afterUpdate: ${record.name}`);
        console.log('  [Hook] Changed fields:', Object.keys(changes));

        if ('public' in changes) {
          const pm = new ProfileManager(ctx.session);
          const resourceUri = record['@id'] as string;

          if (record.public) {
            console.log('  [Hook] Resource became public, adding to Profile...');
            await pm.addToProfile(FOAF_MADE, resourceUri);
          } else {
            console.log('  [Hook] Resource became private, removing from Profile...');
            await pm.removeFromProfile(FOAF_MADE, resourceUri);
          }
        }
      },
      afterDelete: async (ctx: HookContext, record: Record<string, unknown>) => {
        console.log(`  [Hook] afterDelete: ${record.name}`);

        if (record.public) {
          const pm = new ProfileManager(ctx.session);
          const resourceUri = record['@id'] as string;

          console.log('  [Hook] Removing deleted resource from Profile...');
          await pm.removeFromProfile(FOAF_MADE, resourceUri);
        }
      },
    },
  });

  await client.init(agents);

  const agentsCollection = client.collection(agents);

  try {
    console.log('--- Step 1: Insert a public agent ---');
    const publicAgent = await agentsCollection.create({
      name: 'Public Assistant',
      description: 'A publicly visible AI assistant',
      public: true,
    });

    if (!publicAgent?.['@id']) {
      throw new Error('Expected created public agent to include @id');
    }

    console.log(`Inserted: ${publicAgent.name} (id: ${publicAgent.id})`);
    console.log('');

    console.log('--- Step 2: Insert a private agent ---');
    const privateAgent = await agentsCollection.create({
      name: 'Private Helper',
      description: 'A private AI helper',
      public: false,
    });

    if (!privateAgent?.['@id']) {
      throw new Error('Expected created private agent to include @id');
    }

    console.log(`Inserted: ${privateAgent.name} (id: ${privateAgent.id})`);
    console.log('');

    console.log('--- Step 3: Check Profile links ---');
    const pm = new ProfileManager(session);
    const publishedResources = await pm.getLinkedResources(FOAF_MADE);
    console.log(`Resources linked via foaf:made: ${publishedResources.length}`);
    for (const uri of publishedResources) {
      console.log(`  - ${uri}`);
    }
    console.log('');

    console.log('--- Step 4: Make private agent public ---');
    await client.entity(agents, privateAgent['@id']).update({ public: true });
    console.log('Updated agent to public');
    console.log('');

    console.log('--- Step 5: Check Profile links after update ---');
    const updatedResources = await pm.getLinkedResources(FOAF_MADE);
    console.log(`Resources linked via foaf:made: ${updatedResources.length}`);
    for (const uri of updatedResources) {
      console.log(`  - ${uri}`);
    }
    console.log('');

    console.log('--- Step 6: Make public agent private ---');
    await client.entity(agents, publicAgent['@id']).update({ public: false });
    console.log('Updated agent to private');
    console.log('');

    console.log('--- Step 7: Delete an agent ---');
    await client.entity(agents, privateAgent['@id']).update({ public: true });
    await client.entity(agents, privateAgent['@id']).delete();
    console.log('Deleted agent');
    console.log('');

    console.log('--- Step 8: Final Profile check ---');
    const finalResources = await pm.getLinkedResources(FOAF_MADE);
    console.log(`Resources linked via foaf:made: ${finalResources.length}`);
    for (const uri of finalResources) {
      console.log(`  - ${uri}`);
    }
  } finally {
    console.log('\n--- Cleanup ---');
    const remaining = await agentsCollection.list();
    for (const agent of remaining) {
      if (agent['@id']) {
        await client.entity(agents, agent['@id']).delete();
      }
    }
    console.log(`Cleaned up ${remaining.length} remaining agents`);
  }

  console.log('\n=== Example complete ===');
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { run };
