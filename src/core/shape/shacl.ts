/**
 * SHACL Serializer
 *
 * 将 Shape 定义转换为 SHACL Turtle 格式
 */

import type { Shape, ShapeProperty } from './types';
import { SHACL, XSD } from './types';

/**
 * 生成 SHACL Turtle 格式
 */
export function toSHACL(shape: Shape): string {
  const lines: string[] = [];

  // 前缀声明
  lines.push('@prefix sh: <http://www.w3.org/ns/shacl#> .');
  lines.push('@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .');
  lines.push('@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .');
  lines.push('@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .');
  lines.push('');

  // Shape 定义
  lines.push(`<${shape.uri}>`);
  lines.push('    a sh:NodeShape ;');
  lines.push(`    sh:targetClass <${shape.targetClass}> ;`);

  // 名称和描述
  if (shape.name) {
    lines.push(`    sh:name "${escapeString(shape.name)}" ;`);
  }
  if (shape.description) {
    lines.push(`    sh:description "${escapeString(shape.description)}" ;`);
  }

  // 父 Shape (conformsTo)
  if (shape.conformsTo && shape.conformsTo.length > 0) {
    for (const parent of shape.conformsTo) {
      lines.push(`    sh:conformsTo <${parent}> ;`);
    }
  }

  // 属性约束
  if (shape.properties.length > 0) {
    for (let i = 0; i < shape.properties.length; i++) {
      const prop = shape.properties[i];
      const isLast = i === shape.properties.length - 1;
      const propLines = propertyToSHACL(prop);

      lines.push(`    sh:property [`);
      for (const line of propLines) {
        lines.push(`        ${line}`);
      }
      lines.push(`    ]${isLast ? ' .' : ' ;'}`);
    }
  } else {
    // 移除最后一个分号，改为句号
    const lastLine = lines[lines.length - 1];
    lines[lines.length - 1] = lastLine.replace(/ ;$/, ' .');
  }

  return lines.join('\n');
}

/**
 * 将属性转换为 SHACL 属性约束
 */
function propertyToSHACL(prop: ShapeProperty): string[] {
  const lines: string[] = [];

  // 路径 (可能是逆向路径)
  if (prop.inverse) {
    lines.push(`sh:path [ sh:inversePath <${prop.path}> ] ;`);
  } else {
    lines.push(`sh:path <${prop.path}> ;`);
  }

  // 名称
  if (prop.name) {
    lines.push(`sh:name "${escapeString(prop.name)}" ;`);
  }

  // 数据类型
  if (prop.datatype) {
    lines.push(`sh:datatype <${prop.datatype}> ;`);
  }

  // 节点类型
  if (prop.nodeKind) {
    const nodeKindUri = getNodeKindUri(prop.nodeKind);
    lines.push(`sh:nodeKind ${nodeKindUri} ;`);
  }

  // 基数约束
  if (prop.minCount !== undefined) {
    lines.push(`sh:minCount ${prop.minCount} ;`);
  }
  if (prop.maxCount !== undefined) {
    lines.push(`sh:maxCount ${prop.maxCount} ;`);
  }

  // 正则约束
  if (prop.pattern) {
    lines.push(`sh:pattern "${escapeString(prop.pattern)}" ;`);
  }

  // 目标类
  if (prop.class) {
    lines.push(`sh:class <${prop.class}> ;`);
  }

  // 移除最后一行的分号
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    lines[lines.length - 1] = lastLine.replace(/ ;$/, '');
  }

  return lines;
}

/**
 * 获取节点类型 URI
 */
function getNodeKindUri(nodeKind: 'IRI' | 'Literal' | 'BlankNode'): string {
  switch (nodeKind) {
    case 'IRI':
      return 'sh:IRI';
    case 'Literal':
      return 'sh:Literal';
    case 'BlankNode':
      return 'sh:BlankNode';
    default:
      return 'sh:Literal';
  }
}

/**
 * 转义字符串用于 Turtle
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
