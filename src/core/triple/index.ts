/**
 * Triple Module
 *
 * 统一的三元组构建模块
 */

// 类型导出
export type {
  RdfTermType,
  RdfTerm,
  Triple,
  BuildResult,
  BuildContext,
  ColumnHandler,
  TripleBuilder,
  N3PatchOptions,
} from './types';

// 构建器导出
export { TripleBuilderImpl, tripleBuilder } from './builder';

// 处理器导出
export {
  handlerRegistry,
  DefaultHandler,
  UriHandler,
  ArrayHandler,
  InverseHandler,
  InlineObjectHandler,
} from './handlers';
