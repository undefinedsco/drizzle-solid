// RDF 谓词常量
export const RDF_PREDICATES = {
  // Schema.org 谓词
  SCHEMA_NAME: 'https://schema.org/name',
  SCHEMA_DESCRIPTION: 'https://schema.org/description',
  SCHEMA_DATE_CREATED: 'https://schema.org/dateCreated',
  SCHEMA_DATE_MODIFIED: 'https://schema.org/dateModified',
  SCHEMA_AUTHOR: 'https://schema.org/author',
  SCHEMA_URL: 'https://schema.org/url',
  SCHEMA_IMAGE: 'https://schema.org/image',
  
  // FOAF 谓词
  FOAF_NAME: 'http://xmlns.com/foaf/0.1/name',
  FOAF_KNOWS: 'http://xmlns.com/foaf/0.1/knows',
  FOAF_MBOX: 'http://xmlns.com/foaf/0.1/mbox',
  FOAF_HOMEPAGE: 'http://xmlns.com/foaf/0.1/homepage',
  
  // Dublin Core 谓词
  DC_TITLE: 'http://purl.org/dc/terms/title',
  DC_CREATOR: 'http://purl.org/dc/terms/creator',
  DC_DATE: 'http://purl.org/dc/terms/date',
  DC_SUBJECT: 'http://purl.org/dc/terms/subject',
  
  // RDF 基础谓词
  RDF_TYPE: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  RDFS_LABEL: 'http://www.w3.org/2000/01/rdf-schema#label',
  RDFS_COMMENT: 'http://www.w3.org/2000/01/rdf-schema#comment',
  
  // Solid 特定谓词
  SOLID_STORAGE: 'http://www.w3.org/ns/pim/space#storage',
  SOLID_WORKSPACE: 'http://www.w3.org/ns/pim/space#workspace',
  
  // LDP 谓词
  LDP_CONTAINS: 'http://www.w3.org/ns/ldp#contains',
  LDP_RESOURCE: 'http://www.w3.org/ns/ldp#Resource',
  LDP_CONTAINER: 'http://www.w3.org/ns/ldp#Container'
} as const;

// RDF 类常量
export const RDF_CLASSES = {
  // Schema.org 类
  SCHEMA_THING: 'https://schema.org/Thing',
  SCHEMA_PERSON: 'https://schema.org/Person',
  SCHEMA_ORGANIZATION: 'https://schema.org/Organization',
  SCHEMA_CREATIVE_WORK: 'https://schema.org/CreativeWork',
  SCHEMA_ARTICLE: 'https://schema.org/Article',
  SCHEMA_BLOG_POSTING: 'https://schema.org/BlogPosting',
  
  // FOAF 类
  FOAF_PERSON: 'http://xmlns.com/foaf/0.1/Person',
  FOAF_AGENT: 'http://xmlns.com/foaf/0.1/Agent',
  FOAF_DOCUMENT: 'http://xmlns.com/foaf/0.1/Document',
  
  // Solid 类
  SOLID_PROFILE: 'http://www.w3.org/ns/solid/terms#Profile',
  SOLID_INBOX: 'http://www.w3.org/ns/solid/terms#Inbox',
  
  // LDP 类
  LDP_RESOURCE: 'http://www.w3.org/ns/ldp#Resource',
  LDP_CONTAINER: 'http://www.w3.org/ns/ldp#Container',
  LDP_BASIC_CONTAINER: 'http://www.w3.org/ns/ldp#BasicContainer'
} as const;

// 类型定义
export type RDFPredicate = typeof RDF_PREDICATES[keyof typeof RDF_PREDICATES];
export type RDFClass = typeof RDF_CLASSES[keyof typeof RDF_CLASSES];

// 常用的 RDF 命名空间
export const RDF_NAMESPACES = {
  RDF: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  RDFS: 'http://www.w3.org/2000/01/rdf-schema#',
  OWL: 'http://www.w3.org/2002/07/owl#',
  XSD: 'http://www.w3.org/2001/XMLSchema#',
  FOAF: 'http://xmlns.com/foaf/0.1/',
  SCHEMA: 'https://schema.org/',
  DC: 'http://purl.org/dc/terms/',
  SOLID: 'http://www.w3.org/ns/solid/terms#',
  LDP: 'http://www.w3.org/ns/ldp#',
  PIM: 'http://www.w3.org/ns/pim/space#'
} as const;

// 辅助函数：构建完整的 URI
export function buildURI(namespace: keyof typeof RDF_NAMESPACES, localName: string): string {
  return `${RDF_NAMESPACES[namespace]}${localName}`;
}

// 辅助函数：解析 URI 获取本地名称
export function getLocalName(uri: string): string {
  const lastSlash = uri.lastIndexOf('/');
  const lastHash = uri.lastIndexOf('#');
  const separator = Math.max(lastSlash, lastHash);
  return separator >= 0 ? uri.substring(separator + 1) : uri;
}

// 辅助函数：获取命名空间
export function getNamespace(uri: string): string {
  const lastSlash = uri.lastIndexOf('/');
  const lastHash = uri.lastIndexOf('#');
  const separator = Math.max(lastSlash, lastHash);
  return separator >= 0 ? uri.substring(0, separator + 1) : '';
}