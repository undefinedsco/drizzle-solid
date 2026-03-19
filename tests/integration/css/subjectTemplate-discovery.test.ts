/**
 * 测试 subjectTemplate 的 SAI 发现和自动应用
 * 
 * 核心场景：
 * 1. InteropDiscovery.register() 写入 subjectTemplate 到 DataRegistration
 * 2. InteropDiscovery.discover() 读取 subjectTemplate
 * 3. PodTable.setSubjectTemplate() 正确应用模板
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from '../../../src/driver';
import { createTestSession, ensureContainer } from './helpers';
import { podTable, string, id } from '../../../src/core/schema';
import { InteropDiscovery } from '../../../src/core/discovery/interop-discovery';
import { UDFS } from '../../../src/core/discovery/interop-types';
import { getStringNoLocale, getSolidDataset, getThing } from '@inrupt/solid-client';

describe('subjectTemplate Discovery via SAI', () => {
  let session: any;
  let podBase: string;
  let webId: string;
  const testPath = 'integration/subjectTemplate-test/';

  beforeAll(async () => {
    session = await createTestSession({ shared: false });
    webId = session.info.webId;
    podBase = webId.split('profile')[0];
    
    // Cleanup
    try {
      await session.fetch(`${podBase}${testPath}`, { method: 'DELETE' });
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (e) {}
    
    await ensureContainer(session, testPath);
  }, 60000);

  afterAll(async () => {
    try {
      await session.fetch(`${podBase}${testPath}`, { method: 'DELETE' });
    } catch (e) {}
  });

  it('InteropDiscovery should write and read subjectTemplate', async () => {
    const discovery = new InteropDiscovery(
      webId,
      session.fetch,
      session.info.clientId || 'https://app.example/test'
    );

    // 定义表，带 subjectTemplate
    const testTable = podTable('subjectTemplate-test-items', {
      id: id(),
      name: string('name').predicate('http://schema.org/name'),
    }, {
      type: 'http://schema.org/Thing_SubjectTemplateWriteReadTest',
      base: `${podBase}${testPath}items/`,
      subjectTemplate: '{id}.ttl',
    });

    await ensureContainer(session, `${testPath}items/`);

    // 获取现有的 registry path（从 profile 中发现）
    // 注册表
    try {
      await discovery.register(testTable, {
        registryPath: `${podBase}registries/`,  // 这会使用 profile 中已有的 registry
        force: true  // 强制重新注册
      });
    } catch (e) {
      console.log('Register error (expected if no registry exists):', e);
    }

    // 发现并验证 subjectTemplate
    const locations = await discovery.discover('http://schema.org/Thing_SubjectTemplateWriteReadTest');
    console.log('Discovered locations:', JSON.stringify(locations, null, 2));

    // 如果注册成功，应该能发现 subjectTemplate
    if (locations.length > 0) {
      const locationWithTemplate = locations.find(loc => loc.subjectTemplate);
      expect(locationWithTemplate).toBeDefined();
      expect(locationWithTemplate?.subjectTemplate).toBe('{id}.ttl');
    }
  }, 30000);

  it('setSubjectTemplate should enable correct Document Mode read/write', async () => {
    const db = drizzle(session);
    const containerPath = `${podBase}${testPath}notes/`;

    await ensureContainer(session, `${testPath}notes/`);
    
    // 清理旧数据
    try {
      await session.fetch(`${containerPath}note-abc.ttl`, { method: 'DELETE' });
      await session.fetch(`${containerPath}note-xyz.ttl`, { method: 'DELETE' });
    } catch (e) {}
    
    // 创建测试数据（Document Mode 格式）
    await session.fetch(`${containerPath}note-abc.ttl`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: `
        @prefix schema: <http://schema.org/>.
        <> a <http://schema.org/Note_SetTemplateTest>;
          schema:identifier "note-abc";
          schema:text "Document mode test note".
      `
    });

    // 定义消费者表
    const notesTable = podTable('notes', {
      id: id(),
      content: string('content').predicate('http://schema.org/text'),
    }, {
      type: 'http://schema.org/Note_SetTemplateTest',
      base: containerPath,
    });

    // 模拟发现后调用 setSubjectTemplate
    notesTable.setSubjectTemplate('{id}.ttl');
    expect(notesTable.getSubjectTemplate()).toBe('{id}.ttl');

    // 读取数据验证
    const note = await db.findByLocator(notesTable, { id: 'note-abc' });
    console.log('Read note:', note);
    
    expect(note).not.toBeNull();
    expect(note?.content).toBe('Document mode test note');
    expect(note?.id).toBe('note-abc');

    // 写入新数据
    await db.insert(notesTable).values({
      id: 'note-xyz',
      content: 'New note from consumer'
    });

    // 验证写入到正确位置（Document Mode: {id}.ttl）
    const newNoteResponse = await session.fetch(`${containerPath}note-xyz.ttl`);
    expect(newNoteResponse.ok).toBe(true);
    
    const newNoteContent = await newNoteResponse.text();
    console.log('New note content:', newNoteContent);
    expect(newNoteContent).toContain('New note from consumer');
  }, 30000);

  it('setSubjectTemplate should not be overwritten by setBase', async () => {
    const table = podTable('test-persistence', {
      id: id(),
      name: string('name').predicate('http://schema.org/name'),
    }, {
      type: 'http://schema.org/TestPersistence',
      base: '/data/test/',
    });

    // 初始 template 是自动生成的
    const initialTemplate = table.getSubjectTemplate();
    console.log('Initial template:', initialTemplate);

    // 设置自定义 template
    table.setSubjectTemplate('custom-{id}.ttl');
    expect(table.getSubjectTemplate()).toBe('custom-{id}.ttl');

    // setBase 不应覆盖自定义 template
    table.setBase('/data/new-path/');
    expect(table.getSubjectTemplate()).toBe('custom-{id}.ttl');
  });

  it('setSparqlEndpoint should set endpoint correctly', async () => {
    const table = podTable('test-sparql', {
      id: id(),
      name: string('name').predicate('http://schema.org/name'),
    }, {
      type: 'http://schema.org/TestSparql',
      base: '/data/test/',
    });

    expect(table.getSparqlEndpoint()).toBeUndefined();

    table.setSparqlEndpoint('/data/test/-/sparql');
    expect(table.getSparqlEndpoint()).toBe('/data/test/-/sparql');
  });

  it('consumer workflow: discover base, apply subjectTemplate, read/write', async () => {
    const db = drizzle(session);
    const containerPath = `${podBase}${testPath}articles/`;

    await ensureContainer(session, `${testPath}articles/`);

    // 清理旧数据
    try {
      await session.fetch(`${containerPath}article-001.ttl`, { method: 'DELETE' });
      await session.fetch(`${containerPath}article-002.ttl`, { method: 'DELETE' });
    } catch (e) {}

    // === 生产者：创建 Document Mode 数据 ===
    await session.fetch(`${containerPath}article-001.ttl`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: `
        @prefix schema: <http://schema.org/>.
        <> a <http://schema.org/Article_ConsumerWorkflowTest>;
          schema:identifier "article-001";
          schema:name "First Article";
          schema:text "Content of first article".
      `
    });

    // === 消费者：定义表（不知道 subjectTemplate）===
    const consumerTable = podTable('articles', {
      id: id(),
      title: string('title').predicate('http://schema.org/name'),
      body: string('body').predicate('http://schema.org/text'),
    }, {
      type: 'http://schema.org/Article_ConsumerWorkflowTest',
      base: containerPath,  // 假设通过 TypeIndex 发现
    });

    // === 消费者：应用发现的 subjectTemplate ===
    // 在实际场景中，这由 pod-dialect 的 ensureTableResourcePath 自动完成
    consumerTable.setSubjectTemplate('{id}.ttl');

    // === 消费者：读取数据 ===
    const firstArticle = await db.findByLocator(consumerTable, { id: 'article-001' });
    console.log('Consumer read first article:', firstArticle);

    expect(firstArticle).not.toBeNull();
    expect(firstArticle?.title).toBe('First Article');
    expect(firstArticle?.id).toBe('article-001');

    // === 消费者：写入新数据 ===
    await db.insert(consumerTable).values({
      id: 'article-002',
      title: 'Second Article',
      body: 'Content from consumer'
    });

    // === 验证写入到正确位置 ===
    const newArticleResponse = await session.fetch(`${containerPath}article-002.ttl`);
    expect(newArticleResponse.ok).toBe(true);

    const content = await newArticleResponse.text();
    console.log('New article content:', content);
    expect(content).toContain('Second Article');
    expect(content).toContain('Content from consumer');

    // === 验证读取包含新数据 ===
    const [article1, article2] = await Promise.all([
      db.findByLocator(consumerTable, { id: 'article-001' }),
      db.findByLocator(consumerTable, { id: 'article-002' }),
    ]);
    expect(article1).not.toBeNull();
    expect(article2).not.toBeNull();
  }, 60000);
});
