import { PodTable } from '../pod-table';

/**
 * 数据注册选项
 */
export interface RegisterOptions {
  /** RegistrySet 基础路径（用于自动创建 SAI registry） */
  registryPath?: string;

  /** Shape URL - 如果提供，会在 ShapeTree 中引用此 Shape */
  shapeUrl?: string;

  /** 自定义容器路径（相对于 DataRegistry） */
  containerSlug?: string;

  /** 是否强制重新注册（即使已存在） */
  force?: boolean;
}

/**
 * Shape 信息
 */
export interface ShapeInfo {
  /** Shape URL - 实际的 SHACL Shape 定义位置 */
  url: string;

  /** ShapeTree URL - SAI 发现时的 ShapeTree 位置 */
  shapeTree?: string;

  /** 注册此 Shape 的应用 ID (clientId/appId) */
  registeredBy?: string;

  /** 发现来源 */
  source: 'typeindex' | 'interop' | 'config';
}

/**
 * 数据位置信息 - 以 container 为准
 * 
 * 一个 container 可能有多个 Shape 描述（来自不同 app 的注册）
 * 数据在同一个位置，但可以用不同的 Shape 来解释
 */
export interface DataLocation {
  /** 数据容器 URL - 唯一标识数据位置 */
  container: string;

  /** 主体 URI 模式 (可选) - deprecated, use subjectTemplate */
  subjectPattern?: string;

  /** Subject URI 模板 (e.g., "{id}.ttl" for document mode, "#{id}" for fragment mode) */
  subjectTemplate?: string;

  /** 可用的 Shape 列表（按注册顺序） */
  shapes: ShapeInfo[];

  /** 发现来源（取第一个注册的来源） */
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

  /** 按应用 ID 过滤 */
  appId?: string;
}

/**
 * locationToTable 转换选项
 * 
 * 三种选择 Shape 的方式（按优先级）：
 * 1. shape - 直接传入 ShapeInfo 对象或 Shape URL
 * 2. appId - 选择该 app 注册的 Shape
 * 3. 都不传 - 使用第一个可用的 Shape
 */
export interface LocationToTableOptions {
  /** 直接指定 Shape（ShapeInfo 对象或 Shape URL 字符串） */
  shape?: ShapeInfo | string;

  /** 按 appId 选择该 app 注册的 Shape */
  appId?: string;
}

/**
 * 数据注册信息 - 包含完整的注册元数据
 */
export interface DataRegistrationInfo {
  /** 注册资源的 URL */
  registrationUrl: string;

  /** 数据容器 URL */
  container: string;

  /** RDF 类型 */
  rdfClass: string;

  /** ShapeTree URL */
  shapeTree: string;

  /** Shape URL - 实际的 SHACL Shape 定义 */
  shape?: string;

  /** Subject URI 模板 (e.g., "{id}.ttl" for document mode, "#{id}" for fragment mode) */
  subjectTemplate?: string;

  /** 注册此数据的应用/代理 */
  registeredBy?: string;

  /** 注册时间 */
  registeredAt?: Date;
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
   * @param options 注册选项
   */
  register(table: PodTable, options?: RegisterOptions): Promise<void>;

  /**
   * 发现某类型数据的位置
   * @param rdfClass RDF 类型 URI
   * @param options 可选的过滤选项
   */
  discover(rdfClass: string, options?: DiscoverOptions): Promise<DataLocation[]>;

  /**
   * 检查类型是否已注册
   * @param rdfClass RDF 类型 URI
   */
  isRegistered(rdfClass: string): Promise<boolean>;

  /**
   * 获取所有数据注册 (可选实现)
   */
  discoverAll?(): Promise<DataRegistrationInfo[]>;

  /**
   * 按应用 ID 发现数据位置 (可选实现)
   * @param appId 应用标识符
   */
  discoverByApp?(appId: string): Promise<DataLocation[]>;
}
