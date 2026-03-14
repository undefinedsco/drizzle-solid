import { PodColumnBase } from './schema';

// 定义一个宽松的列类型，接受任何 PodColumnBase 变体
type AnyColumn = PodColumnBase;
type ExpressionValue = unknown;

/**
 * SPARQL 表达式基类
 * 不再实现 drizzle-orm 的 SQLWrapper 接口，避免假 SQL 对象导致的问题
 */
export abstract class SPARQLExpression {
  // 表达式标识符，用于类型检查
  readonly [Symbol.toStringTag] = 'SPARQLExpression';
}

export class BinaryExpression extends SPARQLExpression {
  public readonly type = 'binary_expr';
  constructor(
    public left: AnyColumn | SPARQLExpression | string,
    public operator: string,
    public right: ExpressionValue
  ) {
    super();
  }
}

export class LogicalExpression extends SPARQLExpression {
  public readonly type = 'logical_expr';
  constructor(
    public operator: 'AND' | 'OR',
    public expressions: (SPARQLExpression | ExpressionValue)[]
  ) {
    super();
  }
}

export class UnaryExpression extends SPARQLExpression {
  public readonly type = 'unary_expr';
  constructor(
    public operator: string,
    public value: ExpressionValue
  ) {
    super();
  }
}

export class SelectionAliasExpression extends SPARQLExpression {
  constructor(
    public alias: string
  ) {
    super();
  }
}

export class FunctionExpression extends SPARQLExpression {
  constructor(
    public functionName: string,
    public args: ExpressionValue[]
  ) {
    super();
  }
}
