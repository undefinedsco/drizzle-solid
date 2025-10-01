// 主要入口点
export { drizzle, type SolidDatabase } from './driver';
export type { InruptSession } from './solid';

// 核心类
export { PodDialect } from './core/pod-dialect';
export { PodAsyncSession } from './core/pod-session';
export { PodDatabase } from './core/pod-database';

// SPARQL 相关
export { ASTToSPARQLConverter, type SPARQLQuery } from './core/ast-to-sparql';
export { SolidSPARQLExecutor } from './core/sparql-executor';

// 表和列构建器
export {
  podTable,
  // 标准 Drizzle 风格的列定义
  string,
  int,
  bool,
  date,
  json,
  object,
  // 传统的 Pod 列定义（向后兼容）
  podString,
  podInteger,
  podBoolean,
  podDateTime,
  podJson,
  podObject,
  // 命名空间和常量
  COMMON_NAMESPACES,
  RDF_PREDICATES,
  RDF_CLASSES,
  // 类型
  type PodColumn,
  type PodTable,
  type NamespaceConfig,
  type PodTableOptions,
  type PodColumnOptions,
  type InferTableData,
  type InferInsertData,
  type InferUpdateData
} from './core/pod-table';

// Pod 发现和认证
export {
  discoverPodContainers,
  authenticateWithSolid,
  type PodContainer,
  type AuthenticationResult
} from './core/pod-discovery';

// TypeIndex 管理
export {
  TypeIndexManager,
  type TypeIndexEntry,
  type TypeIndexConfig
} from './core/typeindex-manager';

// 工具函数
export {
  createThing,
  readThing,
  updateThing,
  deleteThing,
  batchThingOperations,
  type ThingData
} from './utils/thing-operations';

export {
  validateRDFData,
  parseRDFResponse,
  type ValidationResult,
  type ParsedRDFData
} from './utils/rdf-validation';

// RDF Schema 解析
export {
  parseRDFSchema,
  getPredicateTypeScriptType,
  validatePredicateType,
  findPredicateType,
  rdfTypeToTypeScript,
  type RDFSchemaDefinition,
  type SchemaParseResult
} from './core/rdf-schema-parser';


// 类型安全的表定义（推荐）
export {
  createTypedTable,
  field,
  CommonFields,
  typedTable,
  type TypedField,
  type TypedTableDefinition,
  type TypedTableResult
} from './core/compile-time-types';

// Zod 集成支持
export {
  createTableSchema,
  createInsertSchema,
  createUpdateSchema,
  TableSchemaBuilder,
  getTableSchema
} from './core/zod-integration';

// 查询条件函数
export {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  and,
  or,
  not,
  conditions,
  type QueryCondition
} from './core/query-conditions';

// 聚合函数
export {
  count,
  sum,
  avg,
  min,
  max,
  type AggregateExpression
} from './core/aggregates';
