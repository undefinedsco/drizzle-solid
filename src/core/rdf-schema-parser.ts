// RDF Schema 解析器
// 从真实的 RDF Schema 中解析类型定义

import { RDF_NAMESPACES } from './rdf-constants';

// RDF Schema 类型定义
export interface RDFSchemaDefinition {
  predicate: string;
  range?: string;      // rdfs:range
  domain?: string;     // rdfs:domain
  type?: string;       // rdf:type
}

// 解析结果
export interface SchemaParseResult {
  definitions: RDFSchemaDefinition[];
  errors: string[];
}

/**
 * 从 RDF Schema 文档中解析类型定义
 */
export async function parseRDFSchema(schemaUrl: string, fetchFn: typeof fetch = globalThis.fetch): Promise<SchemaParseResult> {
  const result: SchemaParseResult = {
    definitions: [],
    errors: []
  };

  try {
    // 获取 RDF Schema 文档
    const response = await fetchFn(schemaUrl);
    if (!response.ok) {
      result.errors.push(`Failed to fetch schema: ${response.status} ${response.statusText}`);
      return result;
    }

    const schemaText = await response.text();
    
    // 解析 Turtle 格式的 RDF Schema
    const definitions = parseTurtleSchema(schemaText);
    result.definitions = definitions;

  } catch (error) {
    result.errors.push(`Error parsing RDF Schema: ${error}`);
  }

  return result;
}

/**
 * 解析 Turtle 格式的 RDF Schema
 */
function parseTurtleSchema(turtleText: string): RDFSchemaDefinition[] {
  const definitions: RDFSchemaDefinition[] = [];
  const lines = turtleText.split('\n');

  let currentSubject = '';
  let currentDefinition: RDFSchemaDefinition | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 跳过注释和空行
    if (trimmedLine.startsWith('#') || trimmedLine === '') {
      continue;
    }

    // 解析主语（predicate 定义）
    if (trimmedLine.includes(' rdfs:range ') || trimmedLine.includes(' rdfs:domain ')) {
      const parts = trimmedLine.split(' ');
      if (parts.length >= 3) {
        const subject = parts[0];
        const predicate = parts[1];
        const object = parts[2].replace(';', '').replace('.', '');

        // 如果是新的主语，保存之前的定义
        if (currentSubject !== subject && currentDefinition) {
          definitions.push(currentDefinition);
          currentDefinition = null;
        }

        // 创建新的定义
        if (!currentDefinition) {
          currentDefinition = {
            predicate: subject
          };
          currentSubject = subject;
        }

        // 添加属性
        if (predicate === 'rdfs:range') {
          currentDefinition.range = object;
        } else if (predicate === 'rdfs:domain') {
          currentDefinition.domain = object;
        }
      }
    }
  }

  // 添加最后一个定义
  if (currentDefinition) {
    definitions.push(currentDefinition);
  }

  return definitions;
}

/**
 * 从 RDF Schema 中查找特定 predicate 的类型定义
 */
export function findPredicateType(
  predicate: string,
  schemaDefinitions: RDFSchemaDefinition[]
): string | null {
  const definition = schemaDefinitions.find(def => def.predicate === predicate);
  return definition?.range || null;
}

/**
 * 将 RDF 数据类型转换为 TypeScript 类型
 */
export function rdfTypeToTypeScript(rdfType: string): string {
  const typeMapping: Record<string, string> = {
    'http://www.w3.org/2001/XMLSchema#string': 'string',
    'http://www.w3.org/2001/XMLSchema#integer': 'number',
    'http://www.w3.org/2001/XMLSchema#decimal': 'number',
    'http://www.w3.org/2001/XMLSchema#boolean': 'boolean',
    'http://www.w3.org/2001/XMLSchema#date': 'Date',
    'http://www.w3.org/2001/XMLSchema#dateTime': 'Date',
    'http://www.w3.org/2001/XMLSchema#time': 'Date',
    'http://www.w3.org/2001/XMLSchema#anyURI': 'string',
    'http://www.w3.org/2000/01/rdf-schema#Literal': 'string',
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString': 'string',
    // 支持简化的命名空间
    'xsd:string': 'string',
    'xsd:integer': 'number',
    'xsd:decimal': 'number',
    'xsd:boolean': 'boolean',
    'xsd:date': 'Date',
    'xsd:dateTime': 'Date',
    'xsd:time': 'Date',
    'xsd:anyURI': 'string',
    'rdfs:Literal': 'string'
  };

  return typeMapping[rdfType] || 'string';
}

/**
 * 获取 predicate 的 TypeScript 类型
 */
export function getPredicateTypeScriptType(
  predicate: string,
  schemaDefinitions: RDFSchemaDefinition[]
): string {
  const rdfType = findPredicateType(predicate, schemaDefinitions);
  if (rdfType) {
    return rdfTypeToTypeScript(rdfType);
  }
  
  // 如果没有找到类型定义，返回默认类型
  return 'string';
}

/**
 * 验证 predicate 类型定义
 */
export function validatePredicateType(
  predicate: string,
  expectedType: string,
  schemaDefinitions: RDFSchemaDefinition[]
): { isValid: boolean; message?: string } {
  const actualType = getPredicateTypeScriptType(predicate, schemaDefinitions);
  
  if (actualType === expectedType) {
    return { isValid: true };
  }
  
  return {
    isValid: false,
    message: `Predicate ${predicate} is defined as ${actualType} in RDF Schema, but you're using ${expectedType}`
  };
}
