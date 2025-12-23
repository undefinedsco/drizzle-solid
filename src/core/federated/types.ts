/**
 * Federated Query Types
 * 
 * 联邦查询的类型定义
 */

import type { SolidSchema, PodTable } from '../pod-table';

/**
 * 联邦查询错误
 */
export interface FederatedError {
  /** 错误路径，如 [0, 'posts'] 表示第一个元素的 posts 字段 */
  path: (string | number)[];
  
  /** 错误代码 */
  code: 'FORBIDDEN' | 'NOT_FOUND' | 'TIMEOUT' | 'NETWORK_ERROR' | 'DISCOVERY_FAILED';
  
  /** 错误消息 */
  message: string;
  
  /** 相关的 URL（可选） */
  url?: string;
}

/**
 * 联邦查询结果
 * 遵循 GraphQL 风格：data 和 errors 分开
 */
export interface FederatedResult<T> {
  /** 查询结果数据 */
  data: T;
  
  /** 错误列表（如果有） */
  errors?: FederatedError[];
}

/**
 * 联邦查询选项
 */
export interface FederatedQueryOptions {
  /** 超时时间（毫秒） */
  timeout?: number;
  
  /** 是否并行查询多个 Pod */
  parallel?: boolean;
  
  /** 最大并发数 */
  maxConcurrency?: number;
}

/**
 * 发现的数据位置
 */
export interface DiscoveredLocation {
  /** WebID 来源 */
  webId: string;
  
  /** Pod URL */
  podUrl: string;
  
  /** 数据容器 URL */
  containerUrl: string;
  
  /** 发现来源 */
  source: 'sai' | 'typeindex';
}

/**
 * 联邦查询上下文
 */
export interface FederatedQueryContext {
  /** 父记录 */
  parentRecord: Record<string, unknown>;
  
  /** 父记录在结果中的索引 */
  parentIndex: number;
  
  /** 关系名称 */
  relationName: string;
  
  /** 目标 schema */
  targetSchema: SolidSchema<any>;
  
  /** 发现到的位置列表 */
  locations: DiscoveredLocation[];
}
