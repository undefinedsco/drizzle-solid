/**
 * 08-schema-inheritance.ts
 *
 * 展示 Drizzle Solid 的 Schema 继承功能：
 * 1. 使用 solidSchema 定义基类 schema
 * 2. 使用 schema.extend() 创建子类 schema
 * 3. 子类自动继承父类所有列
 * 4. 子类可以添加新属性、增强约束，但不能修改 predicate
 * 5. subClassOf 自动包含父类 type（RDF 层面的继承）
 *
 * 使用场景示例：密钥管理系统
 * - Secret（基类）：通用密钥属性
 * - APIKey（子类）：API 密钥特有属性
 * - Password（子类）：密码特有属性
 * - OAuthToken（子类）：OAuth 令牌特有属性
 */

import { drizzle, solidSchema, id, string, datetime, uri, boolean, eq } from 'drizzle-solid';
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

// ============ 定义词汇表 ============
const VAULT = {
  // Classes
  Secret: 'https://vault.example/vocab#Secret',
  APIKey: 'https://vault.example/vocab#APIKey',
  Password: 'https://vault.example/vocab#Password',
  OAuthToken: 'https://vault.example/vocab#OAuthToken',
  // Properties
  name: 'https://vault.example/vocab#name',
  createdAt: 'https://vault.example/vocab#createdAt',
  expiresAt: 'https://vault.example/vocab#expiresAt',
  apiKey: 'https://vault.example/vocab#apiKey',
  service: 'https://vault.example/vocab#service',
  hash: 'https://vault.example/vocab#hash',
  salt: 'https://vault.example/vocab#salt',
  accessToken: 'https://vault.example/vocab#accessToken',
  refreshToken: 'https://vault.example/vocab#refreshToken',
  scopes: 'https://vault.example/vocab#scopes',
  active: 'https://vault.example/vocab#active',
};

// ============ 定义基类 Schema ============

/**
 * 基类 Schema：Secret
 *
 * 包含所有密钥类型共有的属性：
 * - id: 唯一标识符
 * - name: 密钥名称（便于识别）
 * - createdAt: 创建时间（自动设置）
 * - expiresAt: 过期时间（可选）
 */
const secretSchema = solidSchema({
  id: id(),
  name: string('name').notNull().predicate(VAULT.name),
  createdAt: datetime('createdAt').defaultNow().predicate(VAULT.createdAt),
  expiresAt: datetime('expiresAt').predicate(VAULT.expiresAt),
}, {
  type: VAULT.Secret,
  subjectTemplate: '{id}.ttl',
});

console.log('基类 Secret Schema:');
console.log('  - type:', secretSchema.type);
console.log('  - columns:', Object.keys(secretSchema.columns));
console.log('');

// ============ 定义子类 Schemas ============

/**
 * 子类 Schema：APIKey
 *
 * 继承 Secret 的所有属性，并添加：
 * - apiKey: API 密钥值（必填）
 * - service: 关联的服务 URI
 * - active: 是否激活（默认 true）
 */
const apiKeySchema = secretSchema.extend({
  apiKey: string('apiKey').notNull().predicate(VAULT.apiKey),
  service: uri('service').predicate(VAULT.service),
  active: boolean('active').default(true).predicate(VAULT.active),
}, {
  type: VAULT.APIKey,
});

console.log('子类 APIKey Schema:');
console.log('  - type:', apiKeySchema.type);
console.log('  - subClassOf:', apiKeySchema.subClassOf);
console.log('  - columns:', Object.keys(apiKeySchema.columns));
console.log('');

/**
 * 子类 Schema：Password
 *
 * 继承 Secret 的所有属性，并添加：
 * - hash: 密码哈希值（必填）
 * - salt: 盐值（必填）
 */
const passwordSchema = secretSchema.extend({
  hash: string('hash').notNull().predicate(VAULT.hash),
  salt: string('salt').notNull().predicate(VAULT.salt),
}, {
  type: VAULT.Password,
});

console.log('子类 Password Schema:');
console.log('  - type:', passwordSchema.type);
console.log('  - subClassOf:', passwordSchema.subClassOf);
console.log('  - columns:', Object.keys(passwordSchema.columns));
console.log('');

/**
 * 子类 Schema：OAuthToken
 *
 * 继承 Secret 的所有属性，并添加：
 * - accessToken: 访问令牌（必填）
 * - refreshToken: 刷新令牌（可选）
 * - scopes: 权限范围
 */
const oauthTokenSchema = secretSchema.extend({
  accessToken: string('accessToken').notNull().predicate(VAULT.accessToken),
  refreshToken: string('refreshToken').predicate(VAULT.refreshToken),
  scopes: string('scopes').predicate(VAULT.scopes),
}, {
  type: VAULT.OAuthToken,
});

console.log('子类 OAuthToken Schema:');
console.log('  - type:', oauthTokenSchema.type);
console.log('  - subClassOf:', oauthTokenSchema.subClassOf);
console.log('  - columns:', Object.keys(oauthTokenSchema.columns));
console.log('');

// ============ 实际使用示例 ============

async function run(providedSession?: Session) {
  console.log('=== Example 08: Schema Inheritance ===\n');

  // 1. 认证
  const session = providedSession || await getAuthenticatedSession();
  const podBase = getPodBaseUrl(session);

  console.log('Connected to Pod:', podBase);

  // 2. 创建数据库实例
  const db = drizzle(session);

  // 3. 实例化表
  const apiKeys = apiKeySchema.table('apiKeys', { base: `${podBase}data/vault/api-keys/` });
  const passwords = passwordSchema.table('passwords', { base: `${podBase}data/vault/passwords/` });
  const oauthTokens = oauthTokenSchema.table('oauthTokens', { base: `${podBase}data/vault/oauth-tokens/` });

  console.log('\n绑定的表:');
  console.log('  - apiKeys base:', apiKeys.config.base);
  console.log('  - passwords base:', passwords.config.base);
  console.log('  - oauthTokens base:', oauthTokens.config.base);

  // 4. CRUD 示例 - 创建 API Key
  console.log('\n--- 创建 API Key ---');

  const newApiKey = {
    name: 'OpenAI API Key',
    apiKey: 'sk-test-123456789',
    service: 'https://api.openai.com',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  };

  await db.insert(apiKeys).values(newApiKey);
  console.log('Created API Key:', newApiKey.name);

  // 5. 查询
  console.log('\n--- 查询 API Keys ---');

  const allApiKeys = await db.select().from(apiKeys);
  console.log('Found', allApiKeys.length, 'API key(s):');

  for (const key of allApiKeys) {
    console.log(`  - ${key.name} (service: ${key.service}, active: ${key.active})`);
  }

  // 6. 创建 Password
  console.log('\n--- 创建 Password ---');

  const newPassword = {
    name: 'Database Admin',
    hash: 'bcrypt$2b$10$...',
    salt: 'random-salt-value',
  };

  await db.insert(passwords).values(newPassword);
  console.log('Created Password:', newPassword.name);

  // 7. 创建 OAuth Token
  console.log('\n--- 创建 OAuth Token ---');

  const newOAuthToken = {
    name: 'GitHub OAuth',
    accessToken: 'gho_xxxxxxxxxxxx',
    refreshToken: 'ghr_xxxxxxxxxxxx',
    scopes: 'repo,user',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
  };

  await db.insert(oauthTokens).values(newOAuthToken);
  console.log('Created OAuth Token:', newOAuthToken.name);

  // 8. 类型推断示例
  console.log('\n--- 类型推断示例 ---');

  // TypeScript 会正确推断这些类型
  type APIKeySelect = typeof apiKeys.$inferSelect;
  type APIKeyInsert = typeof apiKeys.$inferInsert;

  // APIKeySelect 包含: id, name, createdAt, expiresAt, apiKey, service, active
  // APIKeyInsert 要求: name, apiKey (必填), 其他可选

  console.log('APIKey columns:', Object.keys(apiKeys.columns));
  console.log('Password columns:', Object.keys(passwords.columns));
  console.log('OAuthToken columns:', Object.keys(oauthTokens.columns));

  // 9. 清理
  console.log('\n--- 清理数据 ---');

  // 删除创建的数据
  for (const key of allApiKeys) {
    if (key.id) {
      await db.delete(apiKeys).where(eq(apiKeys.id, key.id));
    }
  }

  const allPasswords = await db.select().from(passwords);
  for (const pwd of allPasswords) {
    if (pwd.id) {
      await db.delete(passwords).where(eq(passwords.id, pwd.id));
    }
  }

  const allOAuthTokens = await db.select().from(oauthTokens);
  for (const token of allOAuthTokens) {
    if (token.id) {
      await db.delete(oauthTokens).where(eq(oauthTokens.id, token.id));
    }
  }

  console.log('Cleaned up all test data');

  console.log('\n=== Example completed ===');
}

// 直接运行
run().catch(console.error);

export { secretSchema, apiKeySchema, passwordSchema, oauthTokenSchema, run };
