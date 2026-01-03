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
