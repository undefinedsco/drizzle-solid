/**
 * Column Handlers Registry
 *
 * 注册和管理所有列类型处理器
 */

import type { PodColumnBase } from '../../schema';
import type { ColumnHandler } from '../types';
import { DefaultHandler } from './default';
import { UriHandler } from './uri';
import { ArrayHandler } from './array';
import { InverseHandler } from './inverse';
import { InlineObjectHandler } from './inline';

/**
 * 处理器注册表
 *
 * 处理器按优先级排序，优先匹配特殊类型
 */
class HandlerRegistry {
  private handlers: ColumnHandler[] = [];

  constructor() {
    // 按优先级注册处理器 (特殊类型优先)
    this.register(new InlineObjectHandler()); // object/json
    this.register(new InverseHandler()); // inverse: true
    this.register(new ArrayHandler()); // isArray: true
    this.register(new UriHandler()); // uri
    this.register(new DefaultHandler()); // string, integer, boolean, datetime (最后)
  }

  /**
   * 注册处理器
   */
  register(handler: ColumnHandler): void {
    this.handlers.push(handler);
  }

  /**
   * 获取能处理指定列的处理器
   */
  getHandler(column: PodColumnBase): ColumnHandler {
    for (const handler of this.handlers) {
      if (handler.canHandle(column)) {
        return handler;
      }
    }

    // 不应该到达这里，DefaultHandler 应该能处理所有情况
    throw new Error(`No handler found for column: ${column.name} (type: ${column.dataType})`);
  }

  /**
   * 获取所有已注册的处理器
   */
  getAllHandlers(): ColumnHandler[] {
    return [...this.handlers];
  }
}

// 单例导出
export const handlerRegistry = new HandlerRegistry();

// 导出处理器类
export { DefaultHandler } from './default';
export { UriHandler } from './uri';
export { ArrayHandler } from './array';
export { InverseHandler } from './inverse';
export { InlineObjectHandler } from './inline';
