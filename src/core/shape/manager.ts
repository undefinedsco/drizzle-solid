/**
 * ShapeManager Implementation
 *
 * Shape 管理器实现
 */

import type { PodTable } from '../pod-table';
import type { Shape, ShapeManager, ValidationResult } from './types';
import { generateShape } from './generator';
import { toSHACL } from './shacl';
import { validate } from './validator';

/**
 * ShapeManager 实现
 */
export class ShapeManagerImpl implements ShapeManager {
  /**
   * 从 PodTable 生成 Shape
   */
  generateShape(table: PodTable): Shape {
    return generateShape(table);
  }

  /**
   * 生成 SHACL Turtle 格式
   */
  toSHACL(shape: Shape): string {
    return toSHACL(shape);
  }

  /**
   * 保存 Shape 到 Pod
   */
  async saveShape(
    shape: Shape,
    location: string,
    fetchFn: typeof fetch = globalThis.fetch
  ): Promise<void> {
    const shacl = this.toSHACL(shape);

    const response = await fetchFn(location, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle',
      },
      body: shacl,
    });

    if (!response.ok) {
      throw new Error(`Failed to save shape: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * 从 Pod 加载 Shape
   * 注意：这是一个简化实现，完整的 SHACL 解析需要更复杂的处理
   */
  async loadShape(
    uri: string,
    fetchFn: typeof fetch = globalThis.fetch
  ): Promise<Shape | null> {
    try {
      const response = await fetchFn(uri, {
        headers: {
          'Accept': 'text/turtle',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to load shape: ${response.status} ${response.statusText}`);
      }

      const turtle = await response.text();

      // 简化解析 - 在实际场景中应该使用完整的 RDF 解析器
      return this.parseSimpleSHACL(uri, turtle);
    } catch (error) {
      console.error('Error loading shape:', error);
      return null;
    }
  }

  /**
   * 验证数据是否符合 Shape
   */
  validate(data: Record<string, unknown>, shape: Shape): ValidationResult {
    return validate(data, shape);
  }

  /**
   * 简化的 SHACL 解析 (仅支持基本结构)
   */
  private parseSimpleSHACL(uri: string, turtle: string): Shape | null {
    // 这是一个非常简化的解析器
    // 在生产环境中应该使用 N3.js 或其他 RDF 解析库

    const shape: Shape = {
      uri,
      targetClass: '',
      properties: [],
    };

    // 提取 targetClass
    const targetClassMatch = turtle.match(/sh:targetClass\s+<([^>]+)>/);
    if (targetClassMatch) {
      shape.targetClass = targetClassMatch[1];
    }

    // 提取 name
    const nameMatch = turtle.match(/sh:name\s+"([^"]+)"/);
    if (nameMatch) {
      shape.name = nameMatch[1];
    }

    // 提取 description
    const descMatch = turtle.match(/sh:description\s+"([^"]+)"/);
    if (descMatch) {
      shape.description = descMatch[1];
    }

    // 提取属性 (简化 - 只提取 path)
    const propertyRegex = /sh:property\s+\[\s*([^\]]+)\]/g;
    let propMatch;
    while ((propMatch = propertyRegex.exec(turtle)) !== null) {
      const propContent = propMatch[1];

      const pathMatch = propContent.match(/sh:path\s+<([^>]+)>/);
      if (pathMatch) {
        const prop: any = {
          path: pathMatch[1],
        };

        // 提取 datatype
        const datatypeMatch = propContent.match(/sh:datatype\s+<([^>]+)>/);
        if (datatypeMatch) {
          prop.datatype = datatypeMatch[1];
        }

        // 提取 minCount
        const minCountMatch = propContent.match(/sh:minCount\s+(\d+)/);
        if (minCountMatch) {
          prop.minCount = parseInt(minCountMatch[1], 10);
        }

        // 提取 maxCount
        const maxCountMatch = propContent.match(/sh:maxCount\s+(\d+)/);
        if (maxCountMatch) {
          prop.maxCount = parseInt(maxCountMatch[1], 10);
        }

        // 提取 name
        const propNameMatch = propContent.match(/sh:name\s+"([^"]+)"/);
        if (propNameMatch) {
          prop.name = propNameMatch[1];
        }

        shape.properties.push(prop);
      }
    }

    return shape.targetClass ? shape : null;
  }
}

// 默认实例
export const shapeManager = new ShapeManagerImpl();
