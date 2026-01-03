import { 
  ColumnBuilderDataType, ColumnBuilder, PodColumnBase 
} from './columns';
import { ColumnInput } from './types';
import type { SolidSchema } from './solid-schema';

/**
 * 验证子类列不能修改父类的 predicate
 * @internal
 */
export function validateColumnOverride(
  childColumn: ColumnBuilder<ColumnBuilderDataType, ColumnBuilderDataType | null, boolean, boolean>,
  parentColumn: PodColumnBase<ColumnBuilderDataType, boolean, boolean, ColumnBuilderDataType | null>,
  columnName: string
): void {
  const childPredicate = childColumn.getPredicateUri?.() ?? childColumn.options?.predicate;
  const parentPredicate = parentColumn.options?.predicate;

  if (childPredicate && parentPredicate && childPredicate !== parentPredicate) {
    throw new Error(
      `Schema 继承错误: 不能修改 "${columnName}" 列的 predicate。` +
      `父 schema 定义为 "${parentPredicate}"，` +
      `子 schema 尝试改为 "${childPredicate}"。` +
      `子类只能添加约束（notNull, default），不能更改 predicate。`
    );
  }
}

/**
 * 合并父子 schema 的列定义
 * @internal
 */
export function mergeSchemaColumns<TChildColumns extends Record<string, ColumnInput>>(
  parentSchema: SolidSchema<Record<string, PodColumnBase<ColumnBuilderDataType, boolean, boolean, ColumnBuilderDataType | null>>>,
  childColumns: TChildColumns
): Record<string, PodColumnBase<ColumnBuilderDataType, boolean, boolean, ColumnBuilderDataType | null> | ColumnInput> {
  const mergedColumns: Record<string, PodColumnBase<ColumnBuilderDataType, boolean, boolean, ColumnBuilderDataType | null> | ColumnInput> = {};

  for (const [name, col] of Object.entries(parentSchema.columns)) {
    mergedColumns[name] = col;
  }

  for (const [name, childCol] of Object.entries(childColumns)) {
    const parentCol = parentSchema.columns[name];

    if (parentCol) {
      if (!(childCol instanceof PodColumnBase)) {
        validateColumnOverride(
          childCol as ColumnBuilder<ColumnBuilderDataType, ColumnBuilderDataType | null, boolean, boolean>,
          parentCol,
          name
        );
        const builder = childCol as ColumnBuilder<ColumnBuilderDataType, ColumnBuilderDataType | null, boolean, boolean>;
        if (!builder.getPredicateUri?.() && !builder.options?.predicate) {
          builder.options = { ...builder.options, predicate: parentCol.options?.predicate };
        }
      }
    }
    mergedColumns[name] = childCol;
  }

  return mergedColumns;
}
