// 主要入口点
export { drizzle, type SolidDatabase, type SolidAuthSession } from './driver';
export * from './solid';

// 公共工具
export { findByIRI } from './utils/find-by-iri';

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
  // Schema（不绑定位置）
  solidSchema,
  SolidSchema,
  isSolidSchema,
  // 类型
  type PodColumn,
  type PodTable,
  type SolidSchemaOptions,
  type NamespaceConfig,
  type PodTableOptions,
  type PodTableMapping,
  type PodColumnMapping,
  type PodColumnOptions,
  type InferTableData,
  type InferInsertData,
  type InferUpdateData,
  type RelationDefinition,
  type RelationOptions,
  type DiscoverFunction,
  type HookContext,
  type TableHooks,
  type SolidSession,
  type CreateTableOptions,
} from './core/pod-table';

// Profile 管理（工具类，可在 hooks 中使用）
export { ProfileManager } from './core/profile-manager';

// 查询构建器
export {
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
} from './core/query-builders';
export type { SelectFieldMap, InsertQueryPlan, UpdateQueryPlan, DeleteQueryPlan } from './core/query-builders/types';

// Shape 管理
export {
  DrizzleShapeManager,
  XSD,
  SHACL,
} from './core/shape';
export type {
  ShapeManager,
  Shape,
  ShapeProperty,
  ValidationResult as ShapeValidationResult,
  ValidationError as ShapeValidationError
} from './core/shape';

// DataDiscovery 数据发现
export {
  ProviderCache,
  INTEROP,
  SHAPETREES,
  type DataDiscovery,
  type DataLocation,
  type ShapeInfo,
  type DiscoverOptions,
  type RegisterOptions,
  type DataRegistrationInfo,
  type LocationToTableOptions,
  type WellKnownResponse,
} from './core/discovery';

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
} from './utils/rdf-validation';
export type {
  ValidationResult as RdfValidationResult,
  ParsedRDFData
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
  ilike,
  between,
  notBetween,
  regex,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  and,
  or,
  not,
  exists,
  notExists,
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

// Solid Notifications (实时订阅)
export {
  NotificationsClient,
  type NotificationEvent,
  type NotificationType,
  type ChannelType,
  type SubscribeOptions,
  type TableSubscribeOptions,
  type EntitySubscribeOptions,
  type Subscription,
  type SubscriptionFeature
} from './core/notifications';

// 联邦查询 (Federated Queries)
export {
  FederatedQueryExecutor,
  federatedQueryExecutor,
  type FederatedResult,
  type FederatedError,
  type FederatedQueryOptions,
  type DiscoveredLocation,
  type FederatedQueryContext
} from './core/federated';
