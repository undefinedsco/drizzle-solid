/**
 * Shape Module
 *
 * RDF Shape (SHACL) 管理模块
 */

// 类型导出
export type {
  Shape,
  ShapeProperty,
  ShapeManager,
  ValidationResult,
  ValidationError,
} from './types';

export { XSD, SHACL } from './types';

// 实现导出
export { ShapeManagerImpl, shapeManager } from './manager';
export { generateShape } from './generator';
export { toSHACL } from './shacl';
export { validate } from './validator';
