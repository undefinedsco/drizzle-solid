/**
 * URI Module
 *
 * 统一的 URI 解析模块
 */

// 类型导出
export type {
  ResourceMode,
  ParsedSubject,
  TimeContext,
  UriContext,
  UriResolver,
  SubjectResolver,  // 向后兼容
} from './types';

// 实现导出
export { UriResolverImpl } from './resolver';
