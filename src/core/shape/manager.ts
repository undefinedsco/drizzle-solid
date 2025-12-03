import { PodTable, PodColumnBase } from '../pod-table';
import { Shape, ShapeProperty, ShapeManager, ValidationResult, XSD, SHACL } from './types';
import { getPredicateForColumn } from '../sparql/helpers';
import { z } from 'zod';

export class DrizzleShapeManager implements ShapeManager {
  private podUrl: string;

  constructor(podUrl: string) {
    this.podUrl = podUrl.endsWith('/') ? podUrl : `${podUrl}/`;
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

  async saveShape(shape: Shape, location: string, fetchFn: typeof fetch = globalThis.fetch): Promise<void> {
    const shaclContent = this.toSHACL(shape);
    const response = await fetchFn(location, {
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

  async loadShape(uri: string, fetchFn: typeof fetch = globalThis.fetch): Promise<Shape | null> {
    // This is a complex task requiring an RDF parser and SHACL parsing logic.
    // For now, return null as it's outside the current scope.
    console.warn(`[ShapeManager] loadShape is not implemented yet. URI: ${uri}`);
    return null;
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
