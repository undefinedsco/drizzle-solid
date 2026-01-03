import { PodTable, PodColumnBase, podTable, string, integer, boolean, date, uri, json, object } from '../schema';
import { Shape, ShapeProperty, ShapeManager, ValidationResult, XSD, SHACL } from './types';
import { getPredicateForColumn } from '../sparql/helpers';
import { z } from 'zod';
import { parseSHACL, xsdToDrizzleType, nodeKindToDrizzleType } from './shacl-parser';

/**
 * 从 Shape 生成的表定义
 */
export interface GeneratedTable {
  /** 表名 */
  name: string;
  /** 表定义 */
  table: PodTable;
  /** 来源 Shape */
  shape: Shape;
}

export class DrizzleShapeManager implements ShapeManager {
  private podUrl: string;
  private authenticatedFetch: typeof fetch;

  constructor(podUrl: string, authenticatedFetch?: typeof fetch) {
    this.podUrl = podUrl.endsWith('/') ? podUrl : `${podUrl}/`;
    this.authenticatedFetch = authenticatedFetch ?? globalThis.fetch;
  }

  generateShape(table: PodTable): Shape {
    const tableType = typeof table.config.type === 'string' ? table.config.type : (table.config.type as any).value;
    const resourcePath = table.getResourcePath?.() || table.getContainerPath();
    
    let baseUri = resourcePath;
    if (baseUri && !baseUri.startsWith('http')) {
      baseUri = `${this.podUrl}${baseUri.replace(/^\//, '')}`;
    }
    if (!baseUri) {
      baseUri = this.podUrl;
    }
    
    // Ensure baseUri ends with / if it's a container, or is the file if it's a document
    const isContainer = baseUri.endsWith('/');
    const shapeBase = isContainer ? `${baseUri}shapes/` : `${baseUri.substring(0, baseUri.lastIndexOf('/') + 1)}shapes/`;
    const shapeUri = `${shapeBase}${table.config.name}Shape.ttl#${table.config.name}Shape`;

    const properties: ShapeProperty[] = [];

    Object.entries(table.columns).forEach(([columnName, column]) => {
      // Skip 'id' column as it is the subject identifier
      if (columnName === 'id') return;

      const predicate = getPredicateForColumn(column, table);
      if (!predicate || predicate.includes('example.org/unknown')) return; 

      const prop: ShapeProperty = {
        path: predicate,
        name: column.name,
        minCount: column.options?.required ? 1 : undefined,
        maxCount: (column.dataType === 'array' || column.options?.isArray) ? undefined : 1,
      };

      if (column.options?.inverse) {
        prop.inverse = true;
      }
      
      // Check reference first
      if (column.dataType === 'uri' || column.options?.referenceTarget) {
        prop.datatype = column.dataType === 'uri' ? XSD.ANYURI : undefined;
        prop.nodeKind = SHACL.IRI;
        prop.class = column.options?.referenceTarget;
      } else {
        // Map Drizzle-Solid types to XSD/SHACL nodeKind
        switch (column.dataType) {
          case 'string':
            prop.datatype = XSD.STRING;
            prop.nodeKind = SHACL.LITERAL;
            break;
          case 'integer':
            prop.datatype = XSD.INTEGER;
            prop.nodeKind = SHACL.LITERAL;
            break;
          case 'boolean':
            prop.datatype = XSD.BOOLEAN;
            prop.nodeKind = SHACL.LITERAL;
            break;
          case 'datetime':
            prop.datatype = XSD.DATETIME;
            prop.nodeKind = SHACL.LITERAL;
            break;
          case 'object': 
          case 'json':
            prop.nodeKind = SHACL.BLANK_NODE; 
            break;
          case 'array':
            prop.minCount = column.options?.required ? 1 : 0;
            break;
          default:
            break;
        }
      }

      properties.push(prop);
    });

    return {
      uri: shapeUri,
      name: `${table.config.name} Shape`,
      description: `SHACL Shape for the ${table.config.name} PodTable.`,
      targetClass: tableType,
      properties: properties.filter(p => p.path !== SHACL.PATH)
    };
  }

  toSHACL(shape: Shape): string {
    const lines: string[] = [
      `@prefix sh: <${SHACL.NS}> .`,
      `@prefix xsd: <${XSD.ANYURI.slice(0, XSD.ANYURI.lastIndexOf('#') + 1)}> .`,
      `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`,
      `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`,
      `@prefix schema: <https://schema.org/> .`,
      `@prefix foaf: <http://xmlns.com/foaf/0.1/> .`,
      `@prefix dc: <http://purl.org/dc/terms/> .`,
      `@prefix : <${shape.uri.slice(0, shape.uri.indexOf('#') + 1)}>`,
      '',
      `:${shape.name?.replace(/\s/g, '')} a sh:NodeShape ;`,
      `  sh:targetClass <${shape.targetClass}> ;`,
      `  sh:closed false ;` 
    ];
    
    if (shape.name) {
       lines.push(`  sh:name "${shape.name}" ;`);
    }

    if (shape.description) {
      lines.push(`  sh:description "${shape.description}" ;`);
      lines.push(`  rdfs:comment """${shape.description}""" ;`);
    }
    
    shape.properties.forEach(prop => {
      lines.push(`  sh:property [` );
      lines.push(`    sh:path ${prop.inverse ? `[ sh:inversePath <${prop.path}> ]` : `<${prop.path}>`} ;`);
      if (prop.name) {
        lines.push(`    sh:name "${prop.name}" ;`);
      }
      if (prop.datatype) {
        lines.push(`    sh:datatype <${prop.datatype}> ;`);
      }
      if (prop.nodeKind) {
        lines.push(`    sh:nodeKind <${prop.nodeKind}> ;`);
      }
      if (typeof prop.minCount === 'number') {
        lines.push(`    sh:minCount ${prop.minCount} ;`);
      }
      if (typeof prop.maxCount === 'number') {
        lines.push(`    sh:maxCount ${prop.maxCount} ;`);
      }
      if (prop.pattern) {
        lines.push(`    sh:pattern "${prop.pattern}" ;`);
      }
      if (prop.class) {
        lines.push(`    sh:class <${prop.class}> ;`);
      }
      // Remove trailing semicolon from last property, then add closing bracket.
      lines[lines.length - 1] = lines[lines.length - 1].replace(/\s;$/, '');
      lines.push(`  ] ;`);
    });

    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s;$/, ' .'); // Finalize last property

    return lines.join('\n');
  }

  async saveShape(shape: Shape, location: string, fetchFn?: typeof fetch): Promise<void> {
    const effectiveFetch = fetchFn ?? this.authenticatedFetch;
    const shaclContent = this.toSHACL(shape);
    const response = await effectiveFetch(location, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle'
      },
      body: shaclContent
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Failed to save shape to ${location}: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
    }
  }

  async loadShape(uri: string, fetchFn?: typeof fetch): Promise<Shape | null> {
    const effectiveFetch = fetchFn ?? this.authenticatedFetch;
    try {
      // 获取 Shape 资源
      const response = await effectiveFetch(uri, {
        headers: {
          'Accept': 'text/turtle, application/ld+json'
        }
      });

      if (!response.ok) {
        console.warn(`[ShapeManager] Failed to fetch Shape from ${uri}: ${response.status}`);
        return null;
      }

      const turtle = await response.text();
      
      // 解析 SHACL
      const shapes = await parseSHACL(turtle, uri);
      
      if (shapes.length === 0) {
        console.warn(`[ShapeManager] No shapes found in ${uri}`);
        return null;
      }

      // 返回第一个 Shape，或者匹配 URI 的 Shape
      const exactMatch = shapes.find(s => s.uri === uri || uri.includes(s.uri));
      return exactMatch || shapes[0];
    } catch (error) {
      console.error(`[ShapeManager] Error loading Shape from ${uri}:`, error);
      return null;
    }
  }

  /**
   * 从 Shape 生成 PodTable 定义
   * 
   * @param shape Shape 定义
   * @param containerPath 容器路径（可选）
   * @returns 生成的表定义
   */
  shapeToTable(shape: Shape, containerPath?: string): GeneratedTable {
    // 从 targetClass 提取表名
    const tableName = this.extractTableName(shape);
    
    // 构建列定义
    const columns: Record<string, any> = {
      // 始终包含 id 列
      id: string('id').primaryKey()
    };

    for (const prop of shape.properties) {
      const columnName = prop.name || this.extractNameFromPath(prop.path);
      const column = this.propertyToColumn(prop, columnName);
      if (column) {
        columns[columnName] = column;
      }
    }

    // 创建 PodTable
    const table = podTable(tableName, columns, {
      type: shape.targetClass,
      base: containerPath
    });

    return {
      name: tableName,
      table,
      shape
    };
  }

  /**
   * 从 Shape URI 或 targetClass 提取表名
   */
  private extractTableName(shape: Shape): string {
    // 优先使用 shape.name
    if (shape.name) {
      return shape.name.replace(/\s+/g, '_').replace(/Shape$/i, '').toLowerCase();
    }

    // 从 targetClass 提取
    return this.extractNameFromPath(shape.targetClass).toLowerCase();
  }

  /**
   * 从 URI 路径提取名称
   */
  private extractNameFromPath(path: string): string {
    const hashIndex = path.lastIndexOf('#');
    if (hashIndex >= 0) {
      return path.substring(hashIndex + 1);
    }
    
    const slashIndex = path.lastIndexOf('/');
    if (slashIndex >= 0) {
      return path.substring(slashIndex + 1);
    }
    
    return path;
  }

  /**
   * 将 ShapeProperty 转换为 PodTable 列定义
   */
  private propertyToColumn(prop: ShapeProperty, columnName: string): any {
    // 确定数据类型
    let drizzleType = 'string';
    
    if (prop.nodeKind) {
      const fromNodeKind = nodeKindToDrizzleType(prop.nodeKind);
      if (fromNodeKind) {
        drizzleType = fromNodeKind;
      }
    }
    
    if (prop.datatype) {
      drizzleType = xsdToDrizzleType(prop.datatype);
    }

    // 如果有 class 约束，说明是引用类型
    if (prop.class) {
      drizzleType = 'uri';
    }

    // 判断是否数组
    const isArray = prop.maxCount === undefined || prop.maxCount > 1;
    const isRequired = prop.minCount !== undefined && prop.minCount > 0;

    // 创建列 - 使用列名作为标识符，设置 predicate 为 path URI
    let column: any;
    
    switch (drizzleType) {
      case 'string':
        column = string(columnName).predicate(prop.path);
        break;
      case 'integer':
        column = integer(columnName).predicate(prop.path);
        break;
      case 'boolean':
        column = boolean(columnName).predicate(prop.path);
        break;
      case 'datetime':
        column = date(columnName).predicate(prop.path);
        break;
      case 'uri':
        column = uri(columnName).predicate(prop.path);
        if (prop.class) {
          column = column.references(prop.class);
        }
        break;
      case 'object':
        column = object(columnName).predicate(prop.path);
        break;
      default:
        column = string(columnName).predicate(prop.path);
    }

    // 应用约束
    if (isRequired) {
      column = column.notNull();
    }

    if (isArray) {
      column = column.array();
    }

    if (prop.inverse) {
      column = column.inverse();
    }

    return column;
  }

  validate(data: Record<string, unknown>, shape: Shape): ValidationResult {
    try {
      const zodSchema = this.shapeToZod(shape);
      zodSchema.parse(data);
      return { valid: true };
    } catch (error: any) {
      // console.log('Zod Error:', JSON.stringify(error, null, 2));
      const errors = error instanceof z.ZodError ? error.issues : (error && Array.isArray(error.errors) ? error.errors : undefined);
      
      if (errors) {
        return {
          valid: false,
          errors: errors.map((e: any) => ({
            path: e.path ? String(e.path[0]) : '',
            message: e.message,
            constraint: e.code || 'unknown', 
            value: undefined 
          }))
        };
      }
      return {
        valid: false,
        errors: [{ path: '', message: String(error) }]
      };
    }
  }

  private shapeToZod(shape: Shape): z.ZodObject<any> {
    const shapeMap: Record<string, z.ZodTypeAny> = {};

    shape.properties.forEach(prop => {
      if (!prop.name) return; 

      let zodType: z.ZodTypeAny = z.any();

      // 1. Base Type Mapping
      if (prop.nodeKind === SHACL.IRI) {
        zodType = z.string().url().or(z.string().startsWith('http'));
      } else if (prop.datatype) {
        switch (prop.datatype) {
          case XSD.STRING:
            zodType = z.string();
            if (prop.pattern) {
               zodType = (zodType as z.ZodString).regex(new RegExp(prop.pattern));
            }
            break;
          case XSD.INTEGER:
            zodType = z.number().int().or(z.string().regex(/^\d+$/)); 
            break;
          case XSD.DECIMAL:
          case XSD.DOUBLE:
            zodType = z.number().or(z.string().regex(/^-?\d*\.?\d+$/));
            break;
          case XSD.BOOLEAN:
            zodType = z.boolean().or(z.string().regex(/^(true|false|1|0)$/i));
            break;
          case XSD.DATETIME:
          case XSD.DATE:
            zodType = z.date().or(z.string().datetime({ offset: true }));
            break;
          case XSD.ANYURI:
            zodType = z.string();
            break;
        }
      }

      // 3. Array / Optional Handling
      const isArray = prop.maxCount !== 1;
      const isRequired = prop.minCount !== undefined && prop.minCount > 0;

      if (isArray) {
        zodType = z.array(zodType);
        if (!isRequired) {
          zodType = zodType.optional();
        } else {
          zodType = (zodType as z.ZodArray<any>).min(prop.minCount!);
        }
      } else {
        if (!isRequired) {
          zodType = zodType.optional();
        }
      }

      shapeMap[prop.name] = zodType;
    });

    return z.object(shapeMap);
  }
}
