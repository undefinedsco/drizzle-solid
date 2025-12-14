import { PodTable } from '../pod-table';
import { DataDiscovery, DataLocation, DiscoverOptions, RegisterOptions, DataRegistrationInfo, ShapeInfo } from './types';

/**
 * 按 container 合并多个 DataLocation
 * 同一个 container 的多个结果会被合并，shapes 数组会被合并
 */
function mergeLocationsByContainer(locations: DataLocation[]): DataLocation[] {
  const containerMap = new Map<string, DataLocation>();
  
  for (const loc of locations) {
    const existing = containerMap.get(loc.container);
    if (existing) {
      // 合并 shapes（去重）
      for (const shape of loc.shapes) {
        if (!existing.shapes.some(s => s.url === shape.url)) {
          existing.shapes.push(shape);
        }
      }
    } else {
      containerMap.set(loc.container, {
        container: loc.container,
        subjectPattern: loc.subjectPattern,
        shapes: [...loc.shapes],
        source: loc.source
      });
    }
  }
  
  return Array.from(containerMap.values());
}

export class CompositeDiscovery implements DataDiscovery {
  constructor(private strategies: DataDiscovery[]) {}

  async register(table: PodTable, options?: RegisterOptions): Promise<void> {
    // Register mainly with the first strategy (usually TypeIndex) as default
    // or try all until one succeeds?
    // For now, we use the first one that doesn't fail.
    for (const strategy of this.strategies) {
      try {
        await strategy.register(table, options);
        return; // Success
      } catch (e) {
        console.warn('Registration failed with strategy, trying next:', e);
      }
    }
    throw new Error('Failed to register table with any discovery strategy');
  }

  async discover(rdfClass: string, options?: DiscoverOptions): Promise<DataLocation[]> {
    const allLocations: DataLocation[] = [];
    for (const strategy of this.strategies) {
      try {
        const locations = await strategy.discover(rdfClass, options);
        allLocations.push(...locations);
      } catch (e) {
        console.warn('Discovery failed with strategy, trying next:', e);
      }
    }
    // 按 container 合并结果
    return mergeLocationsByContainer(allLocations);
  }

  async isRegistered(rdfClass: string): Promise<boolean> {
    for (const strategy of this.strategies) {
      if (await strategy.isRegistered(rdfClass)) return true;
    }
    return false;
  }

  /**
   * 获取所有数据注册 - 聚合所有支持此方法的策略结果
   */
  async discoverAll(): Promise<DataRegistrationInfo[]> {
    const allRegistrations: DataRegistrationInfo[] = [];
    for (const strategy of this.strategies) {
      if (strategy.discoverAll) {
        try {
          const registrations = await strategy.discoverAll();
          allRegistrations.push(...registrations);
        } catch (e) {
          console.warn('discoverAll failed with strategy:', e);
        }
      }
    }
    return allRegistrations;
  }

  /**
   * 按应用 ID 发现数据位置 - 聚合所有支持此方法的策略结果
   */
  async discoverByApp(appId: string): Promise<DataLocation[]> {
    const allLocations: DataLocation[] = [];
    for (const strategy of this.strategies) {
      if (strategy.discoverByApp) {
        try {
          const locations = await strategy.discoverByApp(appId);
          allLocations.push(...locations);
        } catch (e) {
          console.warn('discoverByApp failed with strategy:', e);
        }
      }
    }
    // 按 container 合并结果
    return mergeLocationsByContainer(allLocations);
  }
}
