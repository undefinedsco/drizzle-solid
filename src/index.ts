// 主要入口点
export { drizzle, type SolidDatabase, type SolidAuthSession } from './driver';
export * from './solid';

// 核心类
export { PodDialect } from './core/pod-dialect';
export { PodAsyncSession } from './core/pod-session';
export { PodDatabase } from './core/pod-database';
export { findByIRI } from './utils/find-by-iri';

// SPARQL 相关
export { ASTToSPARQLConverter, type SPARQLQuery } from './core/ast-to-sparql';
export { SolidSPARQLExecutor } from './core/sparql-executor';

// 表和列构建器
export {
  podTable,
  // 标准 Drizzle 风格的列定义
  string,
  int,
  integer,
  boolean,
  date,
  json,
  object,
  uri,
  iri,
  // 扩展的列类型别名（兼容所有Drizzle ORM方言）
  text,
  varchar,
  char,
  timestamp,
  datetime,
  bigint,
  smallint,
  tinyint,
  mediumint,
  serial,
  real,
  decimal,
  numeric,
  float,
  double,
  jsonb,
  // 传统的 Pod 列定义（向后兼容）
  podString,
  podInteger,
  podBoolean,
  podDateTime,
  podJson,
  podObject,
  id,
  // 命名空间和常量
  RDF_PREDICATES,
  RDF_CLASSES,
  relations,
  // 类型
  type PodColumn,
  type PodTable,
  type NamespaceConfig,
  type PodTableOptions,
  type PodTableMapping,
  type PodColumnMapping,
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

// DataDiscovery 数据发现
export {
  TypeIndexDiscovery,
  type DataDiscovery,
  type DataLocation,
  type DiscoverOptions,
} from './core/discovery';

// SubjectResolver 主体 URI 解析
export {
  SubjectResolverImpl,
  subjectResolver,
  type SubjectResolver,
  type ResourceMode,
  type ParsedSubject,
  type TimeContext
} from './core/subject';

// TripleBuilder 三元组构建
export {
  TripleBuilderImpl,
  tripleBuilder,
  type TripleBuilder,
  type Triple,
  type BuildResult,
  type ColumnHandler
} from './core/triple';

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

export { extendNamespace } from './utils/namespace';

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
  regex,
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

// 并发冲突解析
export {
  ConflictResolver,
  createConflictResolver,
  saveWithConflictResolution,
  type MergeStrategy,
  type ConflictResolutionConfig,
  type ConflictResolutionResult
} from './core/conflict-resolution';
