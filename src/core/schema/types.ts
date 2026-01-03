import { 
  ColumnBuilderDataType, PodColumnOptions 
} from './defs';
import { 
  PodColumnBase, PodStringColumn, PodIntegerColumn, PodBooleanColumn, 
  PodDateTimeColumn, PodJsonColumn, PodObjectColumn, PodUriColumn, 
  PodArrayColumn, ColumnBuilder 
} from './columns';

export type ColumnValueType<T extends ColumnBuilderDataType> =
  T extends 'string' ? string :
  T extends 'integer' ? number :
  T extends 'boolean' ? boolean :
  T extends 'datetime' ? Date :
  T extends 'json' ? unknown :
  T extends 'object' ? Record<string, unknown> :
  T extends 'uri' ? string :
  T extends 'array' ? unknown[] :
  unknown;

type ExtractNotNull<T extends PodColumnBase> =
  T extends PodColumnBase<any, infer TNotNull, any, any> ? TNotNull : false;

type ExtractHasDefault<T extends PodColumnBase> =
  T extends PodColumnBase<any, any, infer THasDefault, any> ? THasDefault : false;

type ColumnIsRequiredForInsert<T extends PodColumnBase> =
  ExtractNotNull<T> extends true
    ? ExtractHasDefault<T> extends true
      ? false
      : true
    : false;

type ColumnAllowsNull<T extends PodColumnBase> =
  ExtractNotNull<T> extends true ? false : true;

export type InferColumnType<T extends PodColumnBase> =
  T extends PodArrayColumn<infer ElementType, any, any>
    ? ColumnValueType<ElementType>[]
    : ColumnValueType<T['dataType']>;

// eslint-disable-next-line @typescript-eslint/ban-types
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type InferTableData<TTable extends { columns: Record<string, PodColumnBase<any, any, any, any>> }> = Simplify<{
  [K in keyof TTable['columns']]: InferColumnType<TTable['columns'][K]>
}>;

type InsertRequiredColumns<TTable extends { columns: Record<string, PodColumnBase<any, any, any, any>> }> = {
  [K in keyof TTable['columns'] as ColumnIsRequiredForInsert<TTable['columns'][K]> extends true ? K : never]:
    InferColumnType<TTable['columns'][K]>;
};

type InsertOptionalColumns<TTable extends { columns: Record<string, PodColumnBase<any, any, any, any>> }> = {
  [K in keyof TTable['columns'] as ColumnIsRequiredForInsert<TTable['columns'][K]> extends true ? never : K]?:
    InferColumnType<TTable['columns'][K]>;
};

export type InferInsertData<TTable extends { columns: Record<string, PodColumnBase<any, any, any, any>> }> =
  Simplify<InsertRequiredColumns<TTable> & InsertOptionalColumns<TTable>>;

type UpdateColumnValue<T extends PodColumnBase<any, any, any, any>> =
  ColumnAllowsNull<T> extends true ? InferColumnType<T> | null : InferColumnType<T>;

export type InferUpdateData<TTable extends { columns: Record<string, PodColumnBase<any, any, any, any>> }> = Simplify<{
  [K in keyof TTable['columns']]?: UpdateColumnValue<TTable['columns'][K]>
}>;

export type MergedColumns<
  TParent extends Record<string, PodColumnBase<any, any, any, any>>,
  TChild extends Record<string, PodColumnBase<any, any, any, any>>
> = Simplify<{
  [K in keyof TParent | keyof TChild]: K extends keyof TChild
    ? TChild[K]
    : K extends keyof TParent
      ? TParent[K]
      : never;
}>;

export type ColumnInput =
  | PodColumnBase
  | ColumnBuilder<ColumnBuilderDataType, ColumnBuilderDataType | null, boolean, boolean>;

export type ResolveColumn<T> =
  T extends ColumnBuilder<'string', any, infer TNotNull, infer THasDefault>
    ? PodStringColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'integer', any, infer TNotNull, infer THasDefault>
    ? PodIntegerColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'boolean', any, infer TNotNull, infer THasDefault>
    ? PodBooleanColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'datetime', any, infer TNotNull, infer THasDefault>
    ? PodDateTimeColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'json', any, infer TNotNull, infer THasDefault>
    ? PodJsonColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'object', any, infer TNotNull, infer THasDefault>
    ? PodObjectColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'uri', any, infer TNotNull, infer THasDefault>
    ? PodUriColumn<TNotNull, THasDefault>
  : T extends ColumnBuilder<'array', infer TElement, infer TNotNull, infer THasDefault>
    ? PodArrayColumn<
        TElement extends ColumnBuilderDataType ? TElement : ColumnBuilderDataType,
        TNotNull,
        THasDefault
      >
  : T extends PodColumnBase ? T
  : PodColumnBase;

export type ResolvedColumns<T extends Record<string, ColumnInput>> = {
  [K in keyof T]: ResolveColumn<T[K]>;
};
