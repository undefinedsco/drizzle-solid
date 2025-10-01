// RDF 相关工具函数 - 使用 Inrupt 和 Comunica

/**
 * 验证 RDF 三元组格式
 */
export function validateTriple(triple: any): boolean {
  return (
    triple &&
    typeof triple.subject === 'string' &&
    typeof triple.predicate === 'string' &&
    (typeof triple.object === 'string' || 
     typeof triple.object === 'number' || 
     typeof triple.object === 'boolean')
  );
}

/**
 * 生成唯一的资源 URI
 */
export function generateResourceUri(baseUri: string, resourceType: string, id?: string): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  const resourceId = id || `${timestamp}-${randomId}`;
  
  return `${baseUri}/${resourceType}/${resourceId}`;
}

/**
 * 格式化错误信息
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 构建 SPARQL 查询字符串
 */
export function buildSparqlQuery(
  selectFields: string[],
  graphUri: string,
  conditions?: Record<string, any>
): string {
  let query = `SELECT ${selectFields.map(field => `?${field}`).join(' ')}\n`;
  query += `WHERE {\n`;
  query += `  GRAPH <${graphUri}> {\n`;
  
  if (conditions) {
    Object.entries(conditions).forEach(([key, value]) => {
      query += `    ?subject <http://schema.org/${key}> "${value}" .\n`;
    });
  }
  
  query += `  }\n`;
  query += `}`;
  
  return query;
} 