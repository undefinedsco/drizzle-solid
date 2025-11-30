/**
 * Shape Validator
 *
 * 验证数据是否符合 Shape 定义
 */

import type { Shape, ShapeProperty, ValidationResult, ValidationError } from './types';
import { XSD } from './types';

/**
 * 验证数据是否符合 Shape
 */
export function validate(
  data: Record<string, unknown>,
  shape: Shape
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const prop of shape.properties) {
    const propErrors = validateProperty(data, prop);
    errors.push(...propErrors);
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * 验证单个属性
 */
function validateProperty(
  data: Record<string, unknown>,
  prop: ShapeProperty
): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldName = prop.name ?? extractFieldName(prop.path);
  const value = data[fieldName];

  // 检查基数约束
  const valueCount = countValues(value);

  // minCount 约束
  if (prop.minCount !== undefined && valueCount < prop.minCount) {
    errors.push({
      path: prop.path,
      message: `Property '${fieldName}' requires at least ${prop.minCount} value(s), got ${valueCount}`,
      value,
      constraint: 'minCount',
    });
  }

  // maxCount 约束
  if (prop.maxCount !== undefined && valueCount > prop.maxCount) {
    errors.push({
      path: prop.path,
      message: `Property '${fieldName}' allows at most ${prop.maxCount} value(s), got ${valueCount}`,
      value,
      constraint: 'maxCount',
    });
  }

  // 如果有值，检查其他约束
  if (value !== undefined && value !== null) {
    const values = Array.isArray(value) ? value : [value];

    for (const v of values) {
      // 数据类型约束
      if (prop.datatype) {
        const typeError = validateDatatype(v, prop.datatype, fieldName, prop.path);
        if (typeError) {
          errors.push(typeError);
        }
      }

      // 节点类型约束
      if (prop.nodeKind) {
        const kindError = validateNodeKind(v, prop.nodeKind, fieldName, prop.path);
        if (kindError) {
          errors.push(kindError);
        }
      }

      // 正则约束
      if (prop.pattern) {
        const patternError = validatePattern(v, prop.pattern, fieldName, prop.path);
        if (patternError) {
          errors.push(patternError);
        }
      }
    }
  }

  return errors;
}

/**
 * 统计值的数量
 */
function countValues(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  return 1;
}

/**
 * 验证数据类型
 */
function validateDatatype(
  value: unknown,
  datatype: string,
  fieldName: string,
  path: string
): ValidationError | null {
  switch (datatype) {
    case XSD.STRING:
      if (typeof value !== 'string') {
        return {
          path,
          message: `Property '${fieldName}' must be a string, got ${typeof value}`,
          value,
          constraint: 'datatype',
        };
      }
      break;

    case XSD.INTEGER:
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return {
          path,
          message: `Property '${fieldName}' must be an integer, got ${typeof value}`,
          value,
          constraint: 'datatype',
        };
      }
      break;

    case XSD.BOOLEAN:
      if (typeof value !== 'boolean') {
        return {
          path,
          message: `Property '${fieldName}' must be a boolean, got ${typeof value}`,
          value,
          constraint: 'datatype',
        };
      }
      break;

    case XSD.DATETIME:
    case XSD.DATE:
      if (!(value instanceof Date) && typeof value !== 'string') {
        return {
          path,
          message: `Property '${fieldName}' must be a date, got ${typeof value}`,
          value,
          constraint: 'datatype',
        };
      }
      // 如果是字符串，验证是否为有效日期
      if (typeof value === 'string') {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          return {
            path,
            message: `Property '${fieldName}' must be a valid date string`,
            value,
            constraint: 'datatype',
          };
        }
      }
      break;

    case XSD.DECIMAL:
    case XSD.DOUBLE:
      if (typeof value !== 'number') {
        return {
          path,
          message: `Property '${fieldName}' must be a number, got ${typeof value}`,
          value,
          constraint: 'datatype',
        };
      }
      break;
  }

  return null;
}

/**
 * 验证节点类型
 */
function validateNodeKind(
  value: unknown,
  nodeKind: 'IRI' | 'Literal' | 'BlankNode',
  fieldName: string,
  path: string
): ValidationError | null {
  if (nodeKind === 'IRI') {
    // IRI 必须是字符串且为有效 URL
    if (typeof value !== 'string') {
      return {
        path,
        message: `Property '${fieldName}' must be an IRI (string URL), got ${typeof value}`,
        value,
        constraint: 'nodeKind',
      };
    }
    // 简单检查是否看起来像 URL
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      return {
        path,
        message: `Property '${fieldName}' must be a valid IRI starting with http:// or https://`,
        value,
        constraint: 'nodeKind',
      };
    }
  }

  if (nodeKind === 'Literal') {
    // Literal 不能是复杂对象
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
      return {
        path,
        message: `Property '${fieldName}' must be a literal value, not an object`,
        value,
        constraint: 'nodeKind',
      };
    }
  }

  return null;
}

/**
 * 验证正则约束
 */
function validatePattern(
  value: unknown,
  pattern: string,
  fieldName: string,
  path: string
): ValidationError | null {
  if (typeof value !== 'string') {
    return null; // 只对字符串应用 pattern
  }

  const regex = new RegExp(pattern);
  if (!regex.test(value)) {
    return {
      path,
      message: `Property '${fieldName}' does not match pattern '${pattern}'`,
      value,
      constraint: 'pattern',
    };
  }

  return null;
}

/**
 * 从谓词 URI 提取字段名
 */
function extractFieldName(path: string): string {
  // 取 URI 的最后一部分
  const hashIndex = path.lastIndexOf('#');
  const slashIndex = path.lastIndexOf('/');
  const lastIndex = Math.max(hashIndex, slashIndex);

  if (lastIndex !== -1) {
    return path.slice(lastIndex + 1);
  }

  return path;
}
