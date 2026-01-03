import { PodTable } from './pod-table';
import { SolidSchema, isSolidSchema } from './solid-schema';
import { PodColumnBase } from './columns';

export type RelationKind = 'one' | 'many';

export type DiscoverFunction<TParent = any> = (parent: TParent) => string | string[] | undefined;

export interface RelationDefinition {
  type: RelationKind;
  table: PodTable<any> | SolidSchema<any>;
  fields?: PodColumnBase[];
  references?: PodColumnBase[];
  relationName?: string;
  discover?: DiscoverFunction;
  isFederated?: boolean;
}

export type RelationBuilder = {
  one: <T extends PodTable<any> | SolidSchema<any>>(
    table: T,
    options?: RelationOptions<T>
  ) => RelationDefinition;
  many: <T extends PodTable<any> | SolidSchema<any>>(
    table: T,
    options?: RelationOptions<T>
  ) => RelationDefinition;
};

export interface RelationOptions<T = PodTable<any> | SolidSchema<any>> {
  fields?: PodColumnBase[];
  references?: PodColumnBase[];
  relationName?: string;
  discover?: DiscoverFunction;
}

export function relations<TTable extends PodTable<any>>(
  table: TTable,
  builder: (helpers: RelationBuilder) => Record<string, RelationDefinition>
): Record<string, RelationDefinition> {
  const helpers: RelationBuilder = {
    one: (target, options = {}) => {
      const isFederated = isSolidSchema(target);
      return {
        type: 'one',
        table: target,
        fields: options.fields,
        references: options.references,
        relationName: options.relationName,
        discover: options.discover,
        isFederated,
      };
    },
    many: (target, options = {}) => {
      const isFederated = isSolidSchema(target);
      return {
        type: 'many',
        table: target,
        fields: options.fields,
        references: options.references,
        relationName: options.relationName,
        discover: options.discover,
        isFederated,
      };
    }
  };

  const defs = builder(helpers);
  (table as any).relations = defs;
  return defs;
}
