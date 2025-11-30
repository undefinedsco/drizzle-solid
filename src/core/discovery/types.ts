import { PodTable } from '../pod-table';

/**
 * 数据位置信息
 */
export interface DataLocation {
  /** 数据容器 URL */
  container: string;

  /** 主体 URI 模式 (可选) */
  subjectPattern?: string;

  /** Shape URL (可选) */
  shape?: string;

  /** 发现来源 */
  source: 'typeindex' | 'interop' | 'config';
}

/**
 * 发现选项
 */
export interface DiscoverOptions {
  /** 只查找自己注册的 */
  selfOnly?: boolean;

  /** 按应用 origin 过滤 */
  origin?: string;
}

/**
 * 数据发现接口
 *
 * 负责：
 * 1. 注册表的类型到发现机制 (TypeIndex / Interop Registry)
 * 2. 发现某类型数据的存储位置
 * 3. 检查类型是否已注册
 */
export interface DataDiscovery {
  /**
   * 注册表的类型
   * @param table PodTable 定义
   */
  register(table: PodTable): Promise<void>;

  /**
   * 发现某类型数据的位置
   * @param rdfClass RDF 类型 URI
   */
  discover(rdfClass: string): Promise<DataLocation[]>;

  /**
   * 检查类型是否已注册
   * @param rdfClass RDF 类型 URI
   */
  isRegistered(rdfClass: string): Promise<boolean>;
}