/**
 * Shape Generator
 *
 * 从 PodTable 生成 Shape 定义
 */

import type { PodTable, PodColumnBase } from '../pod-table';
import type { Shape, ShapeProperty } from './types';
import { XSD } from './types';

/**
 * 从 PodTable 生成 Shape
 */
export function generateShape(table: PodTable): Shape {
  const tableName = table.config.name;
  const namespace = table.config.namespace;
  const baseUri = namespace?.uri ?? 'https://example.org/shapes/';

  const shape: Shape = {
    uri: `${baseUri}${tableName}Shape`,
    targetClass: table.getType(),
    name: `${tableName} Shape`,
    description: `SHACL shape for ${tableName} (${table.getType()})`,
    properties: [],
  };

  // 处理父类
  const subClassOf = table.getSubClassOf();
  if (subClassOf.length > 0) {
    shape.conformsTo = subClassOf;
  }

  // 生成属性约束
  const columns = table.getColumns();
  for (const column of Object.values(columns)) {
    // 跳过 id 列 (虚拟列)
    if ((column as any)._virtualId) {
      continue;
    }

    const property = columnToShapeProperty(column, table);
    if (property) {
      shape.properties.push(property);
    }
  }

  return shape;
}

/**
 * 将列定义转换为 Shape 属性
 */
function columnToShapeProperty(
  column: PodColumnBase,
  table: PodTable
): ShapeProperty | null {
  const predicate = column.getPredicate(table.getNamespace());

  // 跳过 @id 谓词
  if (predicate === '@id') {
    return null;
  }

  const property: ShapeProperty = {
    path: predicate,
    name: column.name,
  };

  // 设置数据类型
  const datatype = getXsdDatatype(column.dataType);
  if (datatype) {
    property.datatype = datatype;
  }

  // 设置节点类型
  if (column.dataType === 'uri' || column.isReference()) {
    property.nodeKind = 'IRI';
    if (column.isReference()) {
      property.class = column.getReferenceTarget();
    }
  } else if (column.dataType !== 'object' && column.dataType !== 'json') {
    property.nodeKind = 'Literal';
  }

  // 设置基数约束
  if (column.options.required || column.options.notNull) {
    property.minCount = 1;
  }

  // 数组类型没有 maxCount 限制
  if (!column.options.isArray) {
    property.maxCount = 1;
  }

  // 逆向属性
  if (column.isInverse()) {
    property.inverse = true;
  }

  return property;
}

/**
 * 获取 XSD 数据类型
 */
function getXsdDatatype(dataType: string): string | undefined {
  switch (dataType) {
    case 'string':
      return XSD.STRING;
    case 'integer':
      return XSD.INTEGER;
    case 'boolean':
      return XSD.BOOLEAN;
    case 'datetime':
      return XSD.DATETIME;
    case 'uri':
      return undefined; // URI 使用 nodeKind: IRI
    case 'json':
    case 'object':
      return undefined; // 复杂类型不指定 datatype
    case 'array':
      return undefined; // 数组的 datatype 取决于元素类型
    default:
      return XSD.STRING;
  }
}
