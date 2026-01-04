import { 
  NamespaceConfig, SolidSchemaOptions, InstantiateTableOptions, resolveTermIri,
  ColumnBuilderDataType
} from './defs';
import { PodColumnBase, PodIntegerColumn, PodDateTimeColumn, PodBooleanColumn, PodJsonColumn, PodObjectColumn, PodArrayColumn, PodUriColumn, PodStringColumn } from './columns';
import { ColumnInput, MergedColumns, ResolvedColumns, ResolveColumn } from './types';
import { mergeSchemaColumns } from './utils';
import { PodTable, PodTableWithColumns } from './pod-table';

export class SolidSchema<TColumns extends Record<string, PodColumnBase<any, any, any, any>> = Record<string, PodColumnBase<any, any, any, any>>> {
  readonly $kind = 'SolidSchema' as const;
  
  readonly namespace?: NamespaceConfig;
  readonly subjectTemplate?: string;
  readonly subClassOf?: string[];
  
  constructor(
    public readonly columns: TColumns,
    public readonly options: SolidSchemaOptions
  ) {
    this.namespace = options.namespace;
    this.subjectTemplate = options.subjectTemplate;
    this.subClassOf = options.subClassOf 
      ? (Array.isArray(options.subClassOf) 
          ? options.subClassOf.map(resolveTermIri) 
          : [resolveTermIri(options.subClassOf)])
      : undefined;
  }
  
  table(name: string, options: InstantiateTableOptions): PodTableWithColumns<TColumns> {
    return new PodTable(name, this.columns, {
      ...this.options,
      ...options,
    }) as PodTableWithColumns<TColumns>;
  }

  extend<
    TChildColumns extends Record<string, ColumnInput>
  >(
    columns: TChildColumns,
    options: Omit<SolidSchemaOptions, 'subClassOf'>
  ): SolidSchema<MergedColumns<TColumns, ResolvedColumns<TChildColumns>>> {
    const mergedColumnDefs = mergeSchemaColumns(
      this as SolidSchema<Record<string, PodColumnBase<ColumnBuilderDataType, boolean, boolean, ColumnBuilderDataType | null>>>,
      columns
    );

    const subClassOf: string[] = [this.type];
    if (this.subClassOf) {
      subClassOf.push(...this.subClassOf);
    }

    return solidSchema(mergedColumnDefs as TChildColumns, {
      ...options,
      subClassOf,
    }) as unknown as SolidSchema<MergedColumns<TColumns, ResolvedColumns<TChildColumns>>>;
  }

  get type(): string {
    return resolveTermIri(this.options.type);
  }
}

export function solidSchema<
  TColumns extends Record<string, ColumnInput>
>(
  columns: TColumns,
  options: SolidSchemaOptions
): SolidSchema<ResolvedColumns<TColumns>> {
  const processedColumns: Partial<ResolvedColumns<TColumns>> = {};

  for (const [key, value] of Object.entries(columns)) {
    if (value instanceof PodColumnBase) {
      processedColumns[key as keyof TColumns] = value as ResolveColumn<TColumns[typeof key & keyof TColumns]>;
      continue;
    }

    let column: PodColumnBase<any, any, any, any>;
    switch (value.dataType) {
      case 'integer':
        column = new PodIntegerColumn(value.name, value.options);
        break;
      case 'datetime':
        column = new PodDateTimeColumn(value.name, value.options);
        break;
      case 'boolean':
        column = new PodBooleanColumn(value.name, value.options);
        break;
      case 'json':
        column = new PodJsonColumn(value.name, value.options);
        break;
      case 'object':
        column = new PodObjectColumn(value.name, value.options);
        break;
      case 'array': {
        const elementType = (value.elementType ?? value.options.baseType ?? 'string') as ColumnBuilderDataType;
        column = new PodArrayColumn(value.name, elementType, value.options);
        break;
      }
      case 'uri':
        column = new PodUriColumn(value.name, value.options);
        break;
      case 'string':
      default:
        column = new PodStringColumn(value.name, value.options);
        break;
    }

    const predicateUri = (value as any).getPredicateUri?.();
    if (predicateUri) {
      column.predicate(predicateUri);
    }

    processedColumns[key as keyof TColumns] = column as ResolveColumn<TColumns[typeof key & keyof TColumns]>;
  }

  return new SolidSchema(processedColumns as ResolvedColumns<TColumns>, options);
}

export function isSolidSchema(target: unknown): target is SolidSchema<any> {
  return target instanceof SolidSchema || (target as any)?.$kind === 'SolidSchema';
}
