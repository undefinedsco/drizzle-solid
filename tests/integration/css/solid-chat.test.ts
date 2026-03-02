import { describe, it, expect, beforeAll } from 'vitest';
import { drizzle } from '../../../src/driver';
import { createTestSession, createSecondSessionInstance, ensureContainer, grantAccess } from './helpers';
import { podTable, string, id, uri, datetime } from '../../../src/core/schema';
import { INTEROP } from '../../../src/core/discovery/interop-types';
// getSolidDataset, getThing, setUrl, setThing, saveSolidDatasetAt, addUrl - no longer needed, using PATCH directly

// --- 1. 定义 Schema ---

// 消息表：定义聊天消息的结构
const messageTable = podTable('message', {
  id: id(),
  content: string('content').predicate('http://schema.org/text'),
  author: uri('author').predicate('http://schema.org/author'),
  createdAt: datetime('createdAt').predicate('http://schema.org/dateCreated')
}, {
  type: 'http://schema.org/Message',
  base: '/data/chat/message.ttl',  // Fragment mode - all messages in one file
  autoRegister: false 
});

// SAI 辅助表定义 (复用之前的定义，用于 Alice 给 Bob 授权)
const getSaiTables = (podBase: string) => {
  // Use unique path to avoid conflict with other tests
  const registriesPath = `${podBase}registries/chat/`;
  const agentRegistryPath = `${registriesPath}agents/`;
  const appRegResource = `${agentRegistryPath}chat-app.ttl`; // 专用的 chat app 注册文件
  const registrySetResource = `${registriesPath}set.ttl`; // Fragment mode - explicit file path

  const registrySet = podTable('set', {
    id: id(),
    hasAgentRegistry: uri('hasAgentRegistry').array().predicate('http://www.w3.org/ns/solid/interop#hasAgentRegistry'),
  }, {
    type: INTEROP.RegistrySet,
    base: registrySetResource  // Fragment mode: explicit file path
  });

  const applicationRegistration = podTable('app-reg', {
    id: id(),
    registeredAgent: uri('registeredAgent').predicate('http://www.w3.org/ns/solid/interop#registeredAgent'),
    hasAccessGrant: uri('hasAccessGrant').predicate(INTEROP.hasAccessGrant),
  }, {
    type: INTEROP.ApplicationRegistration,
    base: appRegResource
  });

  const accessGrant = podTable('grant', {
    id: id(),
    hasDataGrant: uri('hasDataGrant').array().predicate(INTEROP.hasDataGrant),
  }, {
    type: INTEROP.AccessGrant,
    base: appRegResource
  });

  const dataGrant = podTable('data-grant', {
    id: id(),
    registeredShapeTree: uri('registeredShapeTree').predicate(INTEROP.registeredShapeTree),
    hasDataRegistration: uri('hasDataRegistration').predicate(INTEROP.hasDataRegistration),
    scopeOfGrant: uri('scopeOfGrant').predicate(INTEROP.scopeOfGrant),
  }, {
    type: INTEROP.DataGrant,
    base: appRegResource
  });

  return { registrySet, applicationRegistration, accessGrant, dataGrant, appRegResource, registriesPath, agentRegistryPath };
};

describe('Solid Chat App Integration (Alice & Bob)', () => {
  let aliceSession: any;
  let bobSession: any;
  let alicePodBase: string;
  let bobPodBase: string;
  let appClientId: string;

  // Alice 的聊天室位置
  let chatRoomUrl: string;
  let chatContainer: string;

  beforeAll(async () => {
    // --- 2. 初始化会话 ---
    aliceSession = await createTestSession({ shared: false });
    try {
      bobSession = await createSecondSessionInstance();
    } catch (e) {
      console.warn('Skipping Chat test: Second user credentials not found');
      return;
    }

    alicePodBase = aliceSession.info.webId.split('profile')[0];
    bobPodBase = bobSession.info.webId.split('profile')[0];

    // 标准化 Client ID (确保是 URL 格式，用于 SAI 匹配)
    let rawClientId = aliceSession.info.clientId || process.env.SOLID_CLIENT_ID || 'https://chat-app.example/id';
    if (!rawClientId.startsWith('http')) {
        rawClientId = `https://chat-app.example/${rawClientId}`;
        if (aliceSession.info) (aliceSession.info as any).clientId = rawClientId;
        if (bobSession.info) (bobSession.info as any).clientId = rawClientId;
    }
    appClientId = rawClientId;
    
    console.log('Test Setup: App Client ID:', appClientId);
  }, 120000);

  it('Full Chat Scenario', async () => {
    if (!bobSession) return;

    // --- 3. Alice 准备聊天室 ---
    const aliceDb = drizzle(aliceSession);
    
    chatContainer = `${alicePodBase}data/chat/`;
    // 聊天室是一个资源文件 (Fragment Mode)
    // 改为 message.ttl 以匹配表名，确保 Discovery 默认推断路径正确
    chatRoomUrl = `${chatContainer}message.ttl`;

    console.log('Step 1: Alice creating chat room at', chatRoomUrl);
    
    // 确保容器存在
    await ensureContainer(aliceSession, 'data/chat/');

    // 清理旧数据 (防止 Duplicate primary key)
    try {
        await aliceSession.fetch(chatRoomUrl, { method: 'DELETE' });
    } catch (e) {}

    // Alice 创建第一条消息
    // 即使 autoRegister=false，只要我们显式覆盖 config，Drizzle 就能工作
    // 我们在这里创建一个指向特定位置的 table 实例
    const aliceChatTable = podTable('message', { ...messageTable.columns }, {
        ...messageTable.config,
        base: chatRoomUrl, // 明确指定存储位置
        subjectTemplate: '#{id}' // 强制 Fragment Mode，防止误判为 Document Mode 导致路径错误
    });

    await aliceDb.insert(aliceChatTable).values({
        id: 'msg-1',
        content: 'Welcome to the Solid Chat!',
        author: aliceSession.info.webId,
        createdAt: new Date()
    });

    console.log('Step 1: Alice posted first message.');

    // --- 4. Alice 设置 SAI 授权 ---
    console.log('Step 2: Alice configuring SAI for Bob...');
    
    // 4.1: 物理授权 (ACL/ACP)
    // 显式给资源文件授权，防止容器继承失效
    await grantAccess(aliceSession, chatRoomUrl, bobSession.info.webId, ['Read', 'Append', 'Write']);
    // 同时给容器授权（为了 Discovery 能列出资源）
    await grantAccess(aliceSession, chatContainer, bobSession.info.webId, ['Read']);
    
    // 注意: Write 包含了 Append。在某些 Server 上，Patch 需要 Write 权限。
    // 同时给 Shape Tree 授权 (Discovery 需要)
    const shapeTreeUrl = `${alicePodBase}shapes/message-tree.ttl`;
    await ensureContainer(aliceSession, 'shapes/');
    await aliceSession.fetch(shapeTreeUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: `<${shapeTreeUrl}> <http://www.w3.org/ns/shapetrees#expectsType> <http://schema.org/Message> .`
    });
    await grantAccess(aliceSession, shapeTreeUrl, bobSession.info.webId, ['Read']);

    // 4.2: 逻辑授权 (SAI Registry) - Alice 侧
    // 虽然 Bob 的 Discovery 是查 Bob 的 Pod，但 Alice 侧的记录符合 SAI 规范，且未来可能支持双向发现
    const saiAlice = getSaiTables(alicePodBase);
    
    // 清理 Alice 旧数据 (防止 Duplicate primary key)
    try {
        await aliceSession.fetch(`${saiAlice.registriesPath}set.ttl`, { method: 'DELETE' });
        await aliceSession.fetch(saiAlice.appRegResource, { method: 'DELETE' });
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for deletion
    } catch (e) {}
    
    // 创建/更新 RegistrySet (Alice)
    await ensureContainer(aliceSession, 'registries/');
    await ensureContainer(aliceSession, 'registries/chat/');
    await ensureContainer(aliceSession, 'registries/chat/agents/');
    const setIdAlice = `set-chat-alice-${Date.now()}`;
    await aliceDb.insert(saiAlice.registrySet).values({
        id: setIdAlice,
        hasAgentRegistry: [saiAlice.agentRegistryPath]
    });

    // 链接 Alice Profile -> RegistrySet
    const aliceWebId = aliceSession.info.webId;
    const aliceProfileResource = aliceWebId.split('#')[0];
    const targetRegistrySetUrlAlice = `${saiAlice.registriesPath}set.ttl#${setIdAlice}`;
    
    // 先删除所有旧的 hasRegistrySet 链接，再添加新的
    const patchBodyAliceDelete = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#>.
      @prefix interop: <${INTEROP.NS}>.
      _:patch a solid:InsertDeletePatch;
        solid:where { <${aliceWebId}> interop:hasRegistrySet ?old . };
        solid:deletes { <${aliceWebId}> interop:hasRegistrySet ?old . } .
    `;
    try {
      await aliceSession.fetch(aliceProfileResource, { method: 'PATCH', headers: { 'Content-Type': 'text/n3' }, body: patchBodyAliceDelete });
    } catch (e) {
      // 如果没有旧数据，删除可能失败，忽略
    }
    
    // 添加新的 hasRegistrySet 链接
    const patchBodyAlice = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#>.
      @prefix interop: <${INTEROP.NS}>.
      _:patch a solid:InsertDeletePatch;
        solid:inserts { <${aliceWebId}> interop:hasRegistrySet <${targetRegistrySetUrlAlice}> . } .
    `;
    await aliceSession.fetch(aliceProfileResource, { method: 'PATCH', headers: { 'Content-Type': 'text/n3' }, body: patchBodyAlice });

    // Alice: 创建 Data Grant (记录在案)
    // ... (省略 Alice 侧详细 Grant 创建，为了测试 Bob 的发现，关键是 Bob 侧)
    // 但为了严谨，我们还是保留 Alice 侧的创建逻辑，但简化 ID
    
    // --- 4.5: Bob 侧 SAI 设置 (关键！用于 Bob 发现) ---
    console.log('Step 2.5: Configuring Bob\'s SAI for Discovery...');
    
    const saiBob = getSaiTables(bobPodBase);
    
    // 1. Bob RegistrySet
    await ensureContainer(bobSession, 'registries/');
    await ensureContainer(bobSession, 'registries/chat/');
    const setIdBob = `set-chat-bob-${Date.now()}`;
    
    // 清理旧数据
    try {
        await bobSession.fetch(`${saiBob.registriesPath}set.ttl`, { method: 'DELETE' });
        await bobSession.fetch(saiBob.appRegResource, { method: 'DELETE' });
    } catch (e) {}

    await drizzle(bobSession).insert(saiBob.registrySet).values({
        id: setIdBob,
        hasAgentRegistry: [saiBob.agentRegistryPath]
    });

    // 2. Bob Profile -> RegistrySet
    const bobWebId = bobSession.info.webId;
    const bobProfileResource = bobWebId.split('#')[0];
    const targetRegistrySetUrlBob = `${saiBob.registriesPath}set.ttl#${setIdBob}`;
    
    // 先删除所有旧的 hasRegistrySet 链接，再添加新的
    // 这样可以避免残留数据导致 Discovery 找到错误的路径
    const patchBodyBobDelete = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#>.
      @prefix interop: <${INTEROP.NS}>.
      _:patch a solid:InsertDeletePatch;
        solid:where { <${bobWebId}> interop:hasRegistrySet ?old . };
        solid:deletes { <${bobWebId}> interop:hasRegistrySet ?old . } .
    `;
    try {
      await bobSession.fetch(bobProfileResource, { method: 'PATCH', headers: { 'Content-Type': 'text/n3' }, body: patchBodyBobDelete });
    } catch (e) {
      // 如果没有旧数据，删除可能失败，忽略
    }
    
    // 添加新的 hasRegistrySet 链接
    const patchBodyBob = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#>.
      @prefix interop: <${INTEROP.NS}>.
      _:patch a solid:InsertDeletePatch;
        solid:inserts { <${bobWebId}> interop:hasRegistrySet <${targetRegistrySetUrlBob}> . } .
    `;
    await bobSession.fetch(bobProfileResource, { method: 'PATCH', headers: { 'Content-Type': 'text/n3' }, body: patchBodyBob });

    // 3. Bob Agent Registry & Grants
    await ensureContainer(bobSession, 'registries/chat/agents/');
    await bobSession.fetch(saiBob.appRegResource, { method: 'PUT', headers: { 'Content-Type': 'text/turtle' }, body: '' });

    // 这里的 Data Grant 指向 Alice 的 chatContainer
    const bobAppRegId = 'chat-app-reg-bob';
    const bobGrantId = 'chat-grant-bob';
    const bobDataGrantId = 'chat-data-grant-bob';

    // Data Grant
    await drizzle(bobSession).insert(saiBob.dataGrant).values({
        id: bobDataGrantId,
        hasDataRegistration: chatContainer, // <--- 指向 Alice 的数据！
        registeredShapeTree: shapeTreeUrl,
        scopeOfGrant: 'http://www.w3.org/ns/solid/interop#AllFromRegistry'
    });

    // Access Grant
    const bobDataGrantUri = `${saiBob.appRegResource}#${bobDataGrantId}`;
    await drizzle(bobSession).insert(saiBob.accessGrant).values({
        id: bobGrantId,
        hasDataGrant: [bobDataGrantUri]
    });

    // App Registration
    const bobGrantUri = `${saiBob.appRegResource}#${bobGrantId}`;
    await drizzle(bobSession).insert(saiBob.applicationRegistration).values({
        id: bobAppRegId,
        registeredAgent: appClientId,
        hasAccessGrant: bobGrantUri
    });

    console.log('Step 2: SAI setup complete.');

    // --- 5. Bob 发现并加入聊天 ---
    console.log('Step 3: Bob starting discovery...');
    
    // Bob 初始化 Drizzle，启用 Discovery
    // 注意：我们需要让 Bob 的 messageTable 启用 typeIndex 发现
    const bobChatTable = podTable('message', { ...messageTable.columns }, {
        type: 'http://schema.org/Message',
        base: '/data/chat/message.ttl',  // Placeholder - will be overwritten by discovery
        typeIndex: 'private', // 开启发现
        autoRegister: false
    });

    const bobDb = drizzle(bobSession);

    // Bob 尝试查询消息
    // 此时 Drizzle 应该通过 InteropDiscovery -> Alice's Profile -> Registry -> Data Grant -> Chat Container
    const messages = await bobDb.select().from(bobChatTable);

    console.log('Step 3: Bob found messages:', messages);

    // 验证 Bob 读到了 Alice 的消息
    expect(messages.length).toBeGreaterThan(0);
    const aliceMsg = messages.find(m => m.author === aliceSession.info.webId);
    expect(aliceMsg).toBeDefined();
    expect(aliceMsg?.content).toBe('Welcome to the Solid Chat!');

    // --- 6. Bob 回复消息 ---
    console.log('Step 4: Bob replying...');

    // Bob 插入新消息
    // Drizzle 应该复用 Discovery 发现的路径 (chatRoomUrl)
    await bobDb.insert(bobChatTable).values({
        id: 'msg-2',
        content: 'Hi Alice! Bob here.',
        author: bobSession.info.webId,
        createdAt: new Date()
    });

    console.log('Step 4: Bob reply posted.');

    // --- 7. Alice 验证回复 ---
    console.log('Step 5: Alice checking for updates...');
    
    // DEBUG: Check raw file content
    const rawRes = await aliceSession.fetch(chatRoomUrl);
    if (rawRes.ok) {
        console.log('DEBUG: Raw Chat Room Content:\n', await rawRes.text());
    }
    
    const updatedMessages = await aliceDb.select().from(aliceChatTable);
    console.log('Step 5: Alice sees messages:', updatedMessages);

    expect(updatedMessages.length).toBeGreaterThanOrEqual(2);
    // Find by ID to be robust against single-user test environments where Alice == Bob
    const bobMsg = updatedMessages.find(m => m.id === 'msg-2');
    expect(bobMsg).toBeDefined();
    expect(bobMsg?.content).toBe('Hi Alice! Bob here.');
    expect(bobMsg?.author).toBe(bobSession.info.webId);

  }, 180000);
});
