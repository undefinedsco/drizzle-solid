# Decentralized Resource Discovery

## 概述

传统的资源发现依赖中心化的 Registry（如 npm、Docker Hub）。Solid 可以实现去中心化的资源发现，让每个开发者在自己的 Pod 上发布和管理资源。

## 核心概念

### 1. 资源类型定义

```typescript
// 定义 AI 生态的资源类型
const agents = podTable('agents', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
  description: string('description').predicate('https://schema.org/description'),
  version: string('version').predicate('https://schema.org/version'),
  author: string('author').predicate('https://schema.org/author'),
  repository: string('repository').predicate('https://schema.org/codeRepository'),
  license: string('license').predicate('https://schema.org/license'),
  downloads: integer('downloads').predicate('https://schema.org/interactionCount'),
  rating: decimal('rating').predicate('https://schema.org/aggregateRating'),
}, {
  type: 'https://vocab.ai/Agent',
});

const skills = podTable('skills', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
  description: string('description').predicate('https://schema.org/description'),
  version: string('version').predicate('https://schema.org/version'),
  supportedModels: string('supportedModels').predicate('https://vocab.ai/supportedModels'),
  fileSystemBased: boolean('fileSystemBased').predicate('https://vocab.ai/fileSystemBased'),
  repository: string('repository').predicate('https://schema.org/codeRepository'),
}, {
  type: 'https://vocab.ai/Skill',
});

const models = podTable('models', {
  id: id(),
  name: string('name').predicate('https://schema.org/name'),
  provider: string('provider').predicate('https://vocab.ai/provider'),
  contextWindow: integer('contextWindow').predicate('https://vocab.ai/contextWindow'),
  capabilities: string('capabilities').predicate('https://vocab.ai/capabilities'),
  pricing: string('pricing').predicate('https://schema.org/price'),
}, {
  type: 'https://vocab.ai/Model',
});
```

### 2. 发布者注册网络

轻量级的 WebID 索引网络，不存储实际内容：

```typescript
// 发布者在网络中注册自己的 WebID
const publishers = podTable('publishers', {
  id: id(),
  webId: string('webId').predicate('https://schema.org/identifier'),
  name: string('name').predicate('https://schema.org/name'),
  resourceTypes: string('resourceTypes').predicate('https://vocab.ai/publishes'), // "agents,skills,models"
  lastUpdated: datetime('lastUpdated').predicate('https://schema.org/dateModified'),
}, {
  type: 'https://vocab.ai/Publisher',
});
```

### 3. 联邦搜索实现

```typescript
import { drizzle, FederatedQueryExecutor } from 'drizzle-solid';

class DecentralizedRegistry {
  private executor: FederatedQueryExecutor;
  private knownPublishers: string[] = [];
  
  constructor(session: Session) {
    this.executor = new FederatedQueryExecutor({
      fetch: session.fetch,
      timeout: 5000,
    });
  }
  
  // 从种子节点获取已知发布者列表
  async discoverPublishers(seedNodes: string[]): Promise<void> {
    for (const seed of seedNodes) {
      const db = drizzle(this.session, { 
        schema: { publishers },
        base: seed,
      });
      const pubs = await db.query.publishers.findMany();
      this.knownPublishers.push(...pubs.map(p => p.webId));
    }
  }
  
  // 联邦搜索 Skills
  async searchSkills(query: string): Promise<Skill[]> {
    const results: Skill[] = [];
    
    // 并行查询所有已知发布者的 Pod
    const promises = this.knownPublishers.map(async (webId) => {
      try {
        const podBase = await this.getPodFromWebId(webId);
        const db = drizzle(this.session, {
          schema: { skills },
          base: `${podBase}ai/skills/`,
        });
        
        const found = await db.query.skills.findMany({
          where: (skill, { like }) => like(skill.name, `%${query}%`),
        });
        
        return found.map(s => ({ ...s, publisher: webId }));
      } catch (e) {
        // 某个 Pod 不可用不影响整体搜索
        return [];
      }
    });
    
    const allResults = await Promise.all(promises);
    return allResults.flat();
  }
  
  // 联邦搜索 Agents
  async searchAgents(filters: AgentFilters): Promise<Agent[]> {
    // 类似实现...
  }
}
```

## 优势对比

| 特性 | 中心化 Registry | Solid 去中心化 |
|------|-----------------|----------------|
| 数据所有权 | 平台 | 发布者 |
| 单点故障 | 有 | 无 |
| 审核机制 | 中心审核 | 社区信任/签名 |
| 搜索速度 | 快（单库） | 较慢（联邦查询） |
| 数据一致性 | 强一致 | 最终一致 |
| 扩展性 | 受限于中心服务器 | 无限（分布式） |

## 优化策略

### 1. 缓存层

```typescript
class CachedRegistry extends DecentralizedRegistry {
  private cache: Map<string, { data: any; expires: number }> = new Map();
  
  async searchSkills(query: string): Promise<Skill[]> {
    const cacheKey = `skills:${query}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    
    const results = await super.searchSkills(query);
    this.cache.set(cacheKey, {
      data: results,
      expires: Date.now() + 5 * 60 * 1000, // 5分钟缓存
    });
    
    return results;
  }
}
```

### 2. 索引节点（可选的中心化加速）

```typescript
// 索引节点只存储元数据摘要，不存储完整资源
const skillIndex = podTable('skill_index', {
  id: id(),
  skillId: string('skillId'),
  name: string('name'),
  publisherWebId: string('publisherWebId'),
  podUrl: string('podUrl'),
  lastSynced: datetime('lastSynced'),
}, {
  type: 'https://vocab.ai/SkillIndex',
});

// 索引节点定期从各发布者 Pod 同步
class IndexNode {
  async syncFromPublisher(webId: string) {
    const podBase = await this.getPodFromWebId(webId);
    const skills = await this.fetchSkillsFromPod(podBase);
    
    for (const skill of skills) {
      await this.db.insert(skillIndex).values({
        skillId: skill.id,
        name: skill.name,
        publisherWebId: webId,
        podUrl: podBase,
        lastSynced: new Date(),
      }).onConflictDoUpdate({ target: skillIndex.skillId });
    }
  }
}
```

### 3. 信任网络

```typescript
// 基于 WebID 的信任关系
const trustRelations = podTable('trust', {
  id: id(),
  trustedWebId: string('trustedWebId').predicate('https://vocab.ai/trusts'),
  trustLevel: integer('trustLevel').predicate('https://vocab.ai/trustLevel'), // 1-5
  reason: string('reason').predicate('https://schema.org/description'),
}, {
  type: 'https://vocab.ai/TrustRelation',
});

// 搜索时考虑信任权重
async searchWithTrust(query: string, myWebId: string): Promise<Skill[]> {
  const myTrusts = await this.getMyTrustRelations(myWebId);
  const results = await this.searchSkills(query);
  
  // 根据信任关系排序
  return results.sort((a, b) => {
    const trustA = myTrusts.find(t => t.trustedWebId === a.publisher)?.trustLevel || 0;
    const trustB = myTrusts.find(t => t.trustedWebId === b.publisher)?.trustLevel || 0;
    return trustB - trustA;
  });
}
```

## 实际使用示例

```typescript
import { DecentralizedRegistry } from 'drizzle-solid';

// 初始化
const registry = new DecentralizedRegistry(session);

// 从种子节点发现发布者网络
await registry.discoverPublishers([
  'https://ai-registry.solidcommunity.net/',
  'https://skills.inrupt.net/',
]);

// 搜索 Skills
const codeSkills = await registry.searchSkills('code review');
console.log('Found skills:', codeSkills);

// 搜索 Agents
const agents = await registry.searchAgents({
  capabilities: ['code-generation', 'testing'],
  minRating: 4.0,
});

// 安装（获取资源详情）
const skill = await registry.getSkillDetails(codeSkills[0].id, codeSkills[0].publisher);
console.log('Skill repository:', skill.repository);
```

## 与现有生态集成

```
┌─────────────────────────────────────────────────────────┐
│                    用户应用                              │
├─────────────────────────────────────────────────────────┤
│              DecentralizedRegistry API                   │
├──────────────┬──────────────┬──────────────┬────────────┤
│   Solid Pod  │   Solid Pod  │   Solid Pod  │   ...      │
│   (Alice)    │    (Bob)     │   (Carol)    │            │
│   - Skills   │   - Agents   │   - Models   │            │
│   - Agents   │   - Skills   │   - Skills   │            │
└──────────────┴──────────────┴──────────────┴────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  可选：索引加速节点  │
                    │  (缓存元数据摘要)   │
                    └───────────────────┘
```

## 下一步

1. 定义标准 Vocabulary（vocab.ai）
2. 实现 DecentralizedRegistry 核心类
3. 创建种子节点
4. 构建 CLI 工具（类似 npm）
5. 开发 Web UI 浏览器
