import { entityKind, SQL } from 'drizzle-orm';
import { PodTable, HookContext } from '../schema';
import { PodAsyncSession, PodOperation } from '../pod-session';
import { QueryCondition } from '../query-conditions';
import { DeleteQueryPlan, type SelectFieldMap } from './types';
import {
  buildConditionTreeFromObject,
  inferSPARQLQueryType,
  orderRowsBySubjects,
  projectReturningRows,
  resolveRowSubject,
} from './helpers';

export class DeleteQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  static readonly [entityKind] = 'DeleteQueryBuilder';

  public whereConditions?: Record<string, any>;
  public sql?: SQL;
  private conditionTree?: QueryCondition;
  private returningFields?: SelectFieldMap | true;

  constructor(
    public session: PodAsyncSession,
    public table: TTable
  ) {}

  where(conditions: Record<string, any> | SQL | QueryCondition) {
    if (conditions instanceof SQL) {
      this.sql = conditions;
    } else if (this.isQueryCondition(conditions)) {
      this.conditionTree = conditions;
      const simple = this.convertQueryConditionToSimple(conditions);
      this.whereConditions = Object.keys(simple).length > 0 ? simple : undefined;
    } else {
      if (conditions && typeof conditions === 'object' && '@id' in conditions) {
        throw new Error(
          `Using '@id' in where() is not supported. ` +
          `Use db.deleteByIri(table, iri) for IRI-based deletes, ` +
          `or use { id: 'value' } for id-based deletes.`
        );
      }
      this.whereConditions = conditions;
      this.conditionTree = undefined;
    }
    return this;
  }

  returning(fields?: SelectFieldMap) {
    this.returningFields = fields ?? true;
    return this;
  }

  whereByIri(iri: string) {
    this.whereConditions = { '@id': iri };
    this.conditionTree = undefined;
    return this;
  }

  private isQueryCondition(obj: any): obj is QueryCondition {
    return obj && typeof obj === 'object' && 'type' in obj && 'operator' in obj;
  }

  private convertQueryConditionToSimple(condition: QueryCondition): Record<string, any> {
    if (condition.type === 'binary_expr') {
      const left = (condition as any).left;
      const right = (condition as any).right;
      const colName = typeof left === 'string' ? left : left?.name;
      if (colName && right !== undefined) {
        return { [colName]: right };
      }
    }
    return {};
  }

  private normalizeWhereConditionsForDelete(): QueryCondition | undefined {
    if (this.conditionTree) {
      return this.conditionTree;
    }
    return buildConditionTreeFromObject(this.whereConditions);
  }

  public toIR = (): DeleteQueryPlan<TTable> => {
    const whereCondition = this.normalizeWhereConditionsForDelete();
    return {
      table: this.table,
      where: whereCondition
    };
  };


  private buildSPARQLQuery(methodName = 'toSPARQL()') {
    if (this.sql) {
      const query = this.sql.queryChunks.join('');
      const type = inferSPARQLQueryType(query);
      if (!type) {
        throw new Error(`${methodName} could not infer SPARQL query type from raw AST input`);
      }
      return { type, query, prefixes: {} as Record<string, string> };
    }

    const converter = this.session.getDialect().getSPARQLConverter?.();
    if (!converter) {
      throw new Error(`${methodName} requires dialect SPARQL converter support`);
    }

    const plan = this.toIR();
    return converter.convertDelete(plan.where ?? {}, plan.table);
  }

  toSPARQL() {
    return this.buildSPARQLQuery('toSPARQL()');
  }

  toSparql() {
    return this.toSPARQL();
  }

  async execute(): Promise<any[]> {
    if (this.sql) {
      if (this.returningFields) {
        throw new Error('returning() is not supported for raw SQL delete in Solid dialect');
      }
      return await this.session.executeSql(this.sql, this.table);
    } else {
      const plan = this.toIR();
      const matchedRows = this.returningFields
        ? await this.fetchMatchedRows(plan.where)
        : [];
      const subjects = matchedRows
        .map((row) => resolveRowSubject(row))
        .filter((subject): subject is string => typeof subject === 'string' && subject.length > 0);

      const operation: PodOperation = {
        type: 'delete',
        table: this.table,
        where: plan.where,
        plan
      };
      const results = await this.session.execute(operation);
      const finalResults = this.returningFields
        ? projectReturningRows(orderRowsBySubjects(matchedRows, subjects), this.returningFields)
        : results;

      await this.runAfterDeleteHooks(finalResults);

      return finalResults;
    }
  }

  private async fetchMatchedRows(where?: QueryCondition): Promise<Record<string, any>[]> {
    let builder = this.session.select().from(this.table);
    if (where) {
      builder = builder.where(where);
    }
    return await builder as Record<string, any>[];
  }

  private async runAfterDeleteHooks(results: any[]): Promise<void> {
    const hooks = this.table.config.hooks;
    if (!hooks?.afterDelete) {
      return;
    }

    const ctx = this.buildHookContext();
    if (!ctx) {
      console.warn('[DeleteQueryBuilder] Cannot run hooks: missing session info');
      return;
    }

    for (const record of results) {
      try {
        await hooks.afterDelete(ctx, record as Record<string, unknown>);
      } catch (error) {
        console.error('[DeleteQueryBuilder] afterDelete hook failed:', error);
      }
    }
  }

  private buildHookContext(): HookContext | null {
    const dialect = this.session.getDialect();
    const webId = dialect.getWebId();
    const fetchFn = dialect.getAuthenticatedFetch();

    if (!webId || !fetchFn) {
      return null;
    }

    return {
      session: {
        info: {
          isLoggedIn: true,
          webId,
        },
        fetch: fetchFn,
      },
      table: this.table,
      db: (this.table as any)._db ?? null,
    };
  }

  then<TResult1 = Awaited<ReturnType<DeleteQueryBuilder<TTable>['execute']>>, TResult2 = never>(
    onfulfilled?: ((value: Awaited<ReturnType<DeleteQueryBuilder<TTable>['execute']>>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
