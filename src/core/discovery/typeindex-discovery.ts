import { PodTable } from '../schema';
import { TypeIndexManager, TypeIndexEntry } from '../typeindex-manager';
import { DataDiscovery, DataLocation, DiscoverOptions, RegisterOptions } from './types';
import type { UriResolver } from '../uri';
import { UriResolverImpl } from '../uri';

/**
 * 基于 TypeIndex 的数据发现实现
 */
export class TypeIndexDiscovery implements DataDiscovery {
  private manager: TypeIndexManager;
  private podUrl: string;
  private uriResolver: UriResolver;

  constructor(manager: TypeIndexManager, podUrl: string, uriResolver?: UriResolver) {
    this.manager = manager;
    this.podUrl = podUrl;
    this.uriResolver = uriResolver ?? new UriResolverImpl(podUrl);
  }

  /**
   * 注册表的类型到 TypeIndex
   */
  async register(table: PodTable, _options?: RegisterOptions): Promise<void> {
    const skipTypeIndex = !table.shouldRegisterTypeIndex?.();
    if (skipTypeIndex) {
      console.log(`Table ${table.config.name} has autoRegister disabled, skipping TypeIndex registration`);
      return;
    }

    const tableKey = table.config.name ?? JSON.stringify(table.config);
    // 这里我们假设 PodDialect 会处理资源的实际创建 (ensureContainer/Resource)
    // DataDiscovery 只负责注册信息

    // 准备注册信息
    const rdfClass = this.getRdfClass(table);
    const visibility: 'public' | 'private' = (table as any)._.config?.isPublic ? 'public' : 'private';
    
    // 计算路径
    // 如果是 fragment 模式，instance 指向具体文件
    // 如果是 document 模式，instanceContainer 指向容器
    const resourceMode = this.uriResolver.getResourceMode(table);
    let containerPath = table.getContainerPath() || '/data/';
    let instanceContainer = `${this.podUrl.replace(/\/$/, '')}${containerPath}`;
    
    // 尝试从 resourcePath 反推
    // 这部分逻辑从 PodDialect 迁移过来
    const descriptor = this.resolveTableResource(table);
    if (descriptor.mode === 'ldp') {
      const containerUrl = descriptor.containerUrl;
      const podUrlBase = this.podUrl.replace(/\/$/, '');
      if (containerUrl.startsWith(podUrlBase)) {
        containerPath = containerUrl.substring(podUrlBase.length);
        instanceContainer = containerUrl.replace(/\/$/, '') + '/';
      }
    }

    const entry: TypeIndexEntry = {
      rdfClass,
      containerPath,
      forClass: table.config.name,
      instanceContainer,
      visibility
    };

    // 检查是否已注册且路径一致
    try {
      const existingEntry = await this.manager.discoverSpecificType(rdfClass);

      if (existingEntry && existingEntry.instanceContainer !== instanceContainer) {
        console.warn(
          `[TypeIndexDiscovery] ⚠️  TypeIndex has different path for ${table.config.name}:\n` +
          `  - TypeIndex: ${existingEntry.instanceContainer}\n` +
          `  - Configured: ${instanceContainer}\n` +
          `  Updating TypeIndex to use configured path...`
        );
      }

      // 注册/更新
      await this.manager.registerType(entry);
      console.log(`Table ${table.config.name} registered to TypeIndex with path: ${instanceContainer}`);
    } catch (error: unknown) {
      this.handleRegistrationError(error, entry, visibility);
    }
  }

  /**
   * 发现某类型数据的位置
   */
  async discover(rdfClass: string, _options?: DiscoverOptions): Promise<DataLocation[]> {
    const locations: DataLocation[] = [];
    
    // 查找 public 和 private
    const entries = await this.manager.discoverSpecificTypes([rdfClass]);
    
    for (const entry of entries) {
      locations.push({
        container: entry.instanceContainer ?? entry.containerPath,
        shapes: [],  // TypeIndex 不提供 Shape 信息
        source: 'typeindex'
      });
    }

    return locations;
  }

  /**
   * 检查类型是否已注册
   */
  async isRegistered(rdfClass: string): Promise<boolean> {
    const entry = await this.manager.discoverSpecificType(rdfClass);
    return !!entry;
  }

  // --- Helpers ---

  private getRdfClass(table: PodTable): string {
    return typeof table.config.type === 'string'
      ? table.config.type
      : (table.config.type as any).value || String(table.config.type);
  }

  private resolveTableResource(table: PodTable): { mode: 'ldp' | 'sparql'; containerUrl: string; resourceUrl: string } {
    // 简化的解析逻辑，仅用于获取路径建议
    // 实际的资源解析逻辑在 PodDialect 或 SubjectResolver 中
    const resourcePath = table.getResourcePath?.() ?? table.config.base;
    const containerPath = table.getContainerPath() || '/data/';
    
    // 简单的 LDP 假设
    return {
      mode: 'ldp',
      containerUrl: this.toAbsolute(containerPath),
      resourceUrl: this.toAbsolute(resourcePath ?? containerPath)
    };
  }

  private toAbsolute(path: string): string {
    if (path.startsWith('http')) return path;
    const base = this.podUrl.endsWith('/') ? this.podUrl : `${this.podUrl}/`;
    const rel = path.startsWith('/') ? path.slice(1) : path;
    return `${base}${rel}`;
  }

  private async handleRegistrationError(error: unknown, entry: TypeIndexEntry, visibility: 'public' | 'private') {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('TypeIndex not found')) {
      console.warn('[TypeIndexDiscovery] TypeIndex missing. Attempting to create.');
      try {
        const typeIndexUrl = await this.manager.createTypeIndex(visibility === 'public');
        await this.manager.registerType(entry, typeIndexUrl);
      } catch (creationError: unknown) {
        console.warn('[TypeIndexDiscovery] Unable to create TypeIndex. Continuing without registration.', creationError);
      }
    } else {
      console.warn('[TypeIndexDiscovery] TypeIndex registration failed. Continuing without registration.', error);
    }
  }
}
