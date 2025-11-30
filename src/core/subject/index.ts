/**
 * Subject Module
 *
 * 主体 URI 解析模块
 */

// 类型导出
export type {
  ResourceMode,
  ParsedSubject,
  TimeContext,
  SubjectResolver,
} from './types';

// 实现导出
export { SubjectResolverImpl, subjectResolver } from './resolver';
