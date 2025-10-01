// Drizzle Solid Pod 方言类型定义

export interface PodConfig {
  webId: string;
  fetch?: typeof fetch; // 认证后的 fetch 函数
  options?: {
    typeIndexUrl?: string; // 可选的自定义 typeIndex URL
    storageUrl?: string;   // 可选的自定义存储 URL
  };
}


// RDF 相关类型
export interface RDFTriple {
  subject: string;
  predicate: string;
  object: string | number | boolean;
}

export interface RDFGraph {
  triples: RDFTriple[];
  context?: Record<string, string>;
}

// Drizzle 方言特定类型
export interface PodDialectConfig {
  podConfig: PodConfig;
  defaultFormat: 'json-ld' | 'turtle' | 'rdf-xml';
  typeRegistrations?: TypeRegistration[]; // 类型注册信息
}

// 类型注册配置
export interface TypeRegistration {
  rdfClass: string;        // RDF 类型 URI (如 http://schema.org/Person)
  containerName?: string;  // 容器名称 (如 'people', 'posts')
  forClass: string;        // 对应的本地类名 (如 'Person', 'BlogPost')
}

export interface PodQueryResult<T = any> {
  data: T;
  source: 'pod';
  timestamp: Date;
}

// 映射 Drizzle 操作到 Pod 操作
export interface PodOperation {
  type: 'select' | 'insert' | 'update' | 'delete';
  resource: string;
  data?: any;
  conditions?: any;
  limit?: number;
  offset?: number;
  orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>;
  distinct?: boolean;
}


// 查询选项
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}

// 批量操作结果
export interface BatchResult {
  success: boolean;
  affectedRows: number;
  errors?: Error[];
} 
