import { entityKind, SQL } from 'drizzle-orm';
import { PodTable, InferUpdateData, HookContext } from '../schema';
import { PodAsyncSession, PodOperation } from '../pod-session';
import { QueryCondition } from '../query-conditions';
import { UpdateQueryPlan, type SelectFieldMap } from './types';
import {
  buildConditionTreeFromObject,
  inferSPARQLQueryType,
  orderRowsBySubjects,
  projectReturningRows,
  resolveRowSubject,
} from './helpers';

export class UpdateQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  static readonly [entityKind] = 'UpdateQueryBuilder';

  public updateData?: InferUpdateData<TTable>;
  public whereConditions?: Record<string, any>;
  public sql?: SQL;
  private conditionTree?: QueryCondition;
  private returningFields?: SelectFieldMap | true;

  constructor(
    public session: PodAsyncSession,
    public table: TTable
  ) {}

  set(data: InferUpdateData<TTable> | SQL) {
    if (data instanceof SQL) {
      this.sql = data;
    } else {
      this.updateData = data;
    }
    return this;
  }

  returning(fields?: SelectFieldMap) {
    this.returningFields = fields ?? true;
    return this;
  }

  where(conditions: Record<string, any> | SQL | QueryCondition) {
    if (conditions instanceof SQL) {
      if (!this.sql) {
        this.sql = conditions;
      }
    } else if (this.isQueryCondition(conditions)) {
      this.conditionTree = conditions;
      const simple = this.convertQueryConditionToSimple(conditions);
      this.whereConditions = Object.keys(simple).length > 0 ? simple : undefined;
    } else {
      if (conditions && typeof conditions === 'object' && '@id' in conditions) {
        throw new Error(
          `Using '@id' in where() is not supported. ` +
          `Use db.updateByIri(table, iri, data) for IRI-based updates, ` +
          `or use { id: 'value' } for id-based updates.`
        );
      }
      this.whereConditions = conditions;
      this.conditionTree = undefined;
    }
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

  private normalizeWhereConditionsForUpdate(): QueryCondition | undefined {
    if (this.conditionTree) {
      return this.conditionTree;
    }
    return buildConditionTreeFromObject(this.whereConditions);
  }

  public toIR = (): UpdateQueryPlan<TTable> => {
    if (!this.updateData) {
      throw new Error('No data specified for UPDATE query');
    }
    const whereCondition = this.normalizeWhereConditionsForUpdate();
    if (!whereCondition) {
      throw new Error('UPDATE operation requires where conditions to locate target resources');
    }
    return {
      table: this.table,
      data: this.updateData,
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
    return converter.convertUpdate(plan.data, plan.where, plan.table);
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
        throw new Error('returning() is not supported for raw SQL update in Solid dialect');
      }
      return await this.session.executeSql(this.sql, this.table);
    } else if (this.updateData) {
      const plan = this.toIR();
      const matchedRows = this.returningFields
        ? await this.fetchMatchedRows(plan.where)
        : [];
      const subjects = matchedRows
        .map((row) => resolveRowSubject(row))
        .filter((subject): subject is string => typeof subject === 'string' && subject.length > 0);

      const operation: PodOperation = {
        type: 'update',
        table: this.table,
        data: plan.data,
        where: plan.where,
        plan
      };
      const results = await this.session.execute(operation);
      const finalResults = this.returningFields
        ? await this.fetchReturningRowsBySubjects(subjects)
        : results;

      await this.runAfterUpdateHooks(finalResults);

      return finalResults;
    } else {
      throw new Error('No data specified for UPDATE query');
    }
  }

  private async fetchMatchedRows(where: QueryCondition): Promise<Record<string, any>[]> {
    return await this.session.select().from(this.table).where(where) as Record<string, any>[];
  }

  private async fetchReturningRowsBySubjects(subjects: string[]): Promise<any[]> {
    if (subjects.length === 0) {
      return [];
    }

    const rows = await this.session.select().from(this.table).whereByIri(subjects) as Record<string, any>[];
    const projected = projectReturningRows(orderRowsBySubjects(rows, subjects), this.returningFields);

    const arrayOverrides = Object.entries(this.updateData ?? {}).filter(([, value]) => Array.isArray(value));
    if (arrayOverrides.length === 0) {
      return projected;
    }

    return projected.map((row) => {
      const normalized = { ...row };
      for (const [key, value] of arrayOverrides) {
        if (key in normalized) {
          normalized[key] = [...(value as unknown[])];
        }
      }
      return normalized;
    });
  }

  private async runAfterUpdateHooks(results: any[]): Promise<void> {
    const hooks = this.table.config.hooks;
    if (!hooks?.afterUpdate) {
      return;
    }

    const ctx = this.buildHookContext();
    if (!ctx) {
      console.warn('[UpdateQueryBuilder] Cannot run hooks: missing session info');
      return;
    }

    const changes = (this.updateData ?? {}) as Record<string, unknown>;

    for (const record of results) {
      try {
        await hooks.afterUpdate(ctx, record as Record<string, unknown>, changes);
      } catch (error) {
        console.error('[UpdateQueryBuilder] afterUpdate hook failed:', error);
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

  then<TResult1 = Awaited<ReturnType<UpdateQueryBuilder<TTable>['execute']>>, TResult2 = never>(
    onfulfilled?: ((value: Awaited<ReturnType<UpdateQueryBuilder<TTable>['execute']>>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
