/**
 * ShapeManager Types
 *
 * RDF Shape (SHACL) 相关的类型定义
 */

import type { PodTable } from '../pod-table';

/**
 * Shape 属性定义
 */
export interface ShapeProperty {
  /** 谓词 URI (SHACL sh:path) */
  path: string;

  /** XSD 数据类型 */
  datatype?: string;

  /** 节点类型 (SHACL sh:nodeKind) */
  nodeKind?: 'IRI' | 'Literal' | 'BlankNode' | string;

  /** 最小出现次数 (SHACL sh:minCount) */
  minCount?: number;

  /** 最大出现次数 (SHACL sh:maxCount) */
  maxCount?: number;

  /** 正则约束 (SHACL sh:pattern) */
  pattern?: string;

  /** 属性名称 (用于错误消息) */
  name?: string;

  /** 是否为逆向属性 */
  inverse?: boolean;

  /** 目标类 (用于对象属性) */
  class?: string;
}

/**
 * Shape 定义
 */
export interface Shape {
  /** Shape URI */
  uri: string;

  /** 目标 RDF 类型 (SHACL sh:targetClass) */
  targetClass: string;

  /** 属性定义 */
  properties: ShapeProperty[];

  /** 父 Shape (SHACL sh:conformsTo) */
  conformsTo?: string[];

  /** Shape 名称 (用于显示) */
  name?: string;

  /** Shape 描述 */
  description?: string;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;

  /** 验证错误列表 */
  errors?: ValidationError[];
}

/**
 * 验证错误
 */
export interface ValidationError {
  /** 属性路径 (谓词 URI) */
  path: string;

  /** 错误消息 */
  message: string;

  /** 实际值 */
  value?: unknown;

  /** 约束名称 */
  constraint?: string;
}

/**
 * Shape 管理器接口
 */
export interface ShapeManager {
  /**
   * 从 PodTable 生成 Shape
   * @param table PodTable 定义
   */
  generateShape(table: PodTable): Shape;

  /**
   * 生成 SHACL Turtle 格式
   * @param shape Shape 定义
   */
  toSHACL(shape: Shape): string;

  /**
   * 保存 Shape 到 Pod
   * @param shape Shape 定义
   * @param location 存储位置
   * @param fetchFn 认证 fetch
   */
  saveShape(shape: Shape, location: string, fetchFn?: typeof fetch): Promise<void>;

  /**
   * 从 Pod 加载 Shape
   * @param uri Shape URI
   * @param fetchFn 认证 fetch
   */
  loadShape(uri: string, fetchFn?: typeof fetch): Promise<Shape | null>;

  /**
   * 验证数据是否符合 Shape
   * @param data 数据记录
   * @param shape Shape 定义
   */
  validate(data: Record<string, unknown>, shape: Shape): ValidationResult;
}

/**
 * XSD 数据类型常量
 */
export const XSD = {
  STRING: 'http://www.w3.org/2001/XMLSchema#string',
  INTEGER: 'http://www.w3.org/2001/XMLSchema#integer',
  BOOLEAN: 'http://www.w3.org/2001/XMLSchema#boolean',
  DATETIME: 'http://www.w3.org/2001/XMLSchema#dateTime',
  DATE: 'http://www.w3.org/2001/XMLSchema#date',
  DECIMAL: 'http://www.w3.org/2001/XMLSchema#decimal',
  DOUBLE: 'http://www.w3.org/2001/XMLSchema#double',
  ANYURI: 'http://www.w3.org/2001/XMLSchema#anyURI',
} as const;

/**
 * SHACL 命名空间常量
 */
export const SHACL = {
  PREFIX: 'sh',
  NS: 'http://www.w3.org/ns/shacl#',
  NODE_SHAPE: 'http://www.w3.org/ns/shacl#NodeShape',
  TARGET_CLASS: 'http://www.w3.org/ns/shacl#targetClass',
  PROPERTY: 'http://www.w3.org/ns/shacl#property',
  PATH: 'http://www.w3.org/ns/shacl#path',
  DATATYPE: 'http://www.w3.org/ns/shacl#datatype',
  NODE_KIND: 'http://www.w3.org/ns/shacl#nodeKind',
  MIN_COUNT: 'http://www.w3.org/ns/shacl#minCount',
  MAX_COUNT: 'http://www.w3.org/ns/shacl#maxCount',
  PATTERN: 'http://www.w3.org/ns/shacl#pattern',
  NAME: 'http://www.w3.org/ns/shacl#name',
  DESCRIPTION: 'http://www.w3.org/ns/shacl#description',
  CLASS: 'http://www.w3.org/ns/shacl#class',
  INVERSE_PATH: 'http://www.w3.org/ns/shacl#inversePath',
  IRI: 'http://www.w3.org/ns/shacl#IRI',
  LITERAL: 'http://www.w3.org/ns/shacl#Literal',
  BLANK_NODE: 'http://www.w3.org/ns/shacl#BlankNode',
} as const;
