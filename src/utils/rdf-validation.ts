import { RDF_PREDICATES, RDF_CLASSES, RDF_NAMESPACES } from '../core/rdf-constants';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RDFTriple {
  subject: string;
  predicate: string;
  object: string | number | Date;
}

export interface ParsedRDFData {
  triples: RDFTriple[];
  subjects: Set<string>;
  predicates: Set<string>;
  objects: Set<string | number | Date>;
}

/**
 * 验证 RDF 数据的有效性
 */
export function validateRDFData(data: any): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  try {
    // 检查数据是否为对象
    if (!data || typeof data !== 'object') {
      result.errors.push('RDF data must be an object');
      result.isValid = false;
      return result;
    }

    // 如果是数组，验证每个元素
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const itemResult = validateRDFItem(data[i], `item[${i}]`);
        result.errors.push(...itemResult.errors);
        result.warnings.push(...itemResult.warnings);
        if (!itemResult.isValid) {
          result.isValid = false;
        }
      }
    } else {
      // 验证单个对象
      const itemResult = validateRDFItem(data, 'root');
      result.errors.push(...itemResult.errors);
      result.warnings.push(...itemResult.warnings);
      if (!itemResult.isValid) {
        result.isValid = false;
      }
    }

    return result;
  } catch (error) {
    result.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    result.isValid = false;
    return result;
  }
}

/**
 * 验证单个 RDF 项目
 */
function validateRDFItem(item: any, path: string): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  // 检查必需的字段
  if (!item.id && !item['@id']) {
    result.warnings.push(`${path}: Missing identifier (id or @id)`);
  }

  // 验证 URI 格式
  for (const [key, value] of Object.entries(item)) {
    if (typeof value === 'string' && key !== 'id' && key !== '@id') {
      // 检查是否是有效的 URI 谓词
      if (isURI(key)) {
        if (!isValidPredicate(key)) {
          result.warnings.push(`${path}.${key}: Unknown predicate URI`);
        }
      } else {
        result.warnings.push(`${path}.${key}: Predicate should be a valid URI`);
      }

      // 检查值是否是有效的 URI（如果应该是的话）
      if (isURI(value) && !isValidURI(value)) {
        result.errors.push(`${path}.${key}: Invalid URI format for value`);
        result.isValid = false;
      }
    }
  }

  return result;
}

/**
 * 解析 RDF 响应数据
 */
export function parseRDFResponse(response: string, format: 'turtle' | 'jsonld' | 'ntriples' = 'turtle'): ParsedRDFData {
  const parsed: ParsedRDFData = {
    triples: [],
    subjects: new Set(),
    predicates: new Set(),
    objects: new Set()
  };

  try {
    switch (format) {
      case 'turtle':
        return parseTurtle(response);
      case 'jsonld':
        return parseJsonLD(response);
      case 'ntriples':
        return parseNTriples(response);
      default:
        throw new Error(`Unsupported RDF format: ${format}`);
    }
  } catch (error) {
    console.error('Error parsing RDF response:', error);
    return parsed;
  }
}

/**
 * 解析 Turtle 格式的 RDF 数据
 */
function parseTurtle(turtle: string): ParsedRDFData {
  const parsed: ParsedRDFData = {
    triples: [],
    subjects: new Set(),
    predicates: new Set(),
    objects: new Set()
  };

  // 简化的 Turtle 解析器
  const lines = turtle.split('\n');
  let currentSubject = '';

  for (const line of lines) {
    const trimmed = line.trim();
    
    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) {
      continue;
    }

    // 简单的三元组匹配
    const tripleMatch = trimmed.match(/^(<[^>]+>|\w+:\w+)\s+(<[^>]+>|\w+:\w+)\s+(.+?)\s*\.?$/);
    
    if (tripleMatch) {
      const [, subject, predicate, object] = tripleMatch;
      
      const cleanSubject = cleanURI(subject);
      const cleanPredicate = cleanURI(predicate);
      const cleanObject = cleanValue(object);

      parsed.triples.push({
        subject: cleanSubject,
        predicate: cleanPredicate,
        object: cleanObject
      });

      parsed.subjects.add(cleanSubject);
      parsed.predicates.add(cleanPredicate);
      parsed.objects.add(cleanObject);
    }
  }

  return parsed;
}

/**
 * 解析 JSON-LD 格式的 RDF 数据
 */
function parseJsonLD(jsonld: string): ParsedRDFData {
  const parsed: ParsedRDFData = {
    triples: [],
    subjects: new Set(),
    predicates: new Set(),
    objects: new Set()
  };

  try {
    const data = JSON.parse(jsonld);
    
    // 处理单个对象或对象数组
    const items = Array.isArray(data) ? data : [data];
    
    for (const item of items) {
      const subject = item['@id'] || item.id || '_:blank';
      
      for (const [key, value] of Object.entries(item)) {
        if (key.startsWith('@')) continue; // 跳过 JSON-LD 关键字
        
        const predicate = expandPredicate(key, item['@context']);
        const objectValue = typeof value === 'object' && value !== null ? 
          ((value as any)['@id'] || (value as any).id || JSON.stringify(value)) : value;

        parsed.triples.push({
          subject,
          predicate,
          object: objectValue
        });

        parsed.subjects.add(subject);
        parsed.predicates.add(predicate);
        parsed.objects.add(objectValue);
      }
    }
  } catch (error) {
    console.error('Error parsing JSON-LD:', error);
  }

  return parsed;
}

/**
 * 解析 N-Triples 格式的 RDF 数据
 */
function parseNTriples(ntriples: string): ParsedRDFData {
  const parsed: ParsedRDFData = {
    triples: [],
    subjects: new Set(),
    predicates: new Set(),
    objects: new Set()
  };

  const lines = ntriples.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // N-Triples 格式: <subject> <predicate> <object> .
    const match = trimmed.match(/^(<[^>]+>)\s+(<[^>]+>)\s+(.+?)\s*\.$/);
    
    if (match) {
      const [, subject, predicate, object] = match;
      
      const cleanSubject = cleanURI(subject);
      const cleanPredicate = cleanURI(predicate);
      const cleanObject = cleanValue(object);

      parsed.triples.push({
        subject: cleanSubject,
        predicate: cleanPredicate,
        object: cleanObject
      });

      parsed.subjects.add(cleanSubject);
      parsed.predicates.add(cleanPredicate);
      parsed.objects.add(cleanObject);
    }
  }

  return parsed;
}

// 辅助函数

function isURI(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return value.includes(':') && !value.includes(' ');
  }
}

function isValidURI(uri: string): boolean {
  try {
    new URL(uri);
    return true;
  } catch {
    return false;
  }
}

function isValidPredicate(predicate: string): boolean {
  // 检查是否是已知的谓词
  return Object.values(RDF_PREDICATES).includes(predicate as any) ||
         Object.values(RDF_NAMESPACES).some(ns => predicate.startsWith(ns));
}

function cleanURI(uri: string): string {
  return uri.replace(/^<|>$/g, '');
}

function cleanValue(value: string): string | number | Date {
  // 移除引号
  if (value.startsWith('"') && value.endsWith('"')) {
    const cleaned = value.slice(1, -1);
    
    // 尝试解析为数字
    const num = Number(cleaned);
    if (!isNaN(num)) {
      return num;
    }
    
    // 尝试解析为日期
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date;
    }
    
    return cleaned;
  }
  
  // 处理 URI
  if (value.startsWith('<') && value.endsWith('>')) {
    return cleanURI(value);
  }
  
  return value;
}

function expandPredicate(key: string, context?: any): string {
  if (isURI(key)) {
    return key;
  }
  
  // 简单的上下文扩展
  if (context && context[key]) {
    return context[key];
  }
  
  // 默认命名空间扩展
  if (key.includes(':')) {
    const [prefix, localName] = key.split(':', 2);
    switch (prefix) {
      case 'foaf':
        return `${RDF_NAMESPACES.FOAF}${localName}`;
      case 'schema':
        return `${RDF_NAMESPACES.SCHEMA}${localName}`;
      case 'dc':
        return `${RDF_NAMESPACES.DC}${localName}`;
      default:
        return key;
    }
  }
  
  return key;
}