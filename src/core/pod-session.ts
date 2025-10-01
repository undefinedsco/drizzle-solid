import { entityKind } from 'drizzle-orm';
import { SQL } from 'drizzle-orm';
import { PodDialect, type PodOperation } from './pod-dialect';
import { PodTable, PodColumnBase, type InferTableData, type InferInsertData, type InferUpdateData } from './pod-table';
import { QueryCondition, inArray } from './query-conditions';
import { AggregateExpression, isAggregateExpression } from './aggregates';

export type SelectField = PodColumnBase | string | AggregateExpression;
export type SelectFieldMap = Record<string, SelectField>;

type JoinType = 'leftJoin' | 'rightJoin' | 'innerJoin' | 'fullJoin';

interface ColumnReference {
  table: PodTable<any>;
  alias: string;
  column: string;
}

interface ResolvedJoinCondition {
  left: ColumnReference;
  right: ColumnReference;
}

interface ResolvedJoinDefinition {
  type: JoinType;
  table: PodTable<any>;
  alias: string;
  conditions: ResolvedJoinCondition[];
}

export class PodAsyncSession {
  static readonly [entityKind] = 'PodAsyncSession';

  constructor(
    private dialect: PodDialect,
    private schema?: any,
    private options: { logger?: boolean } = {}
  ) {}

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.dialect.isConnected();
  }

  /**
   * 获取方言实例
   */
  getDialect(): PodDialect {
    return this.dialect;
  }

  /**
   * 获取会话选项
   */
  getOptions(): { logger?: boolean } {
    return this.options;
  }

  // 执行查询操作
  async execute(operation: PodOperation): Promise<any[]> {
    if (this.options.logger) {
      console.log('Executing operation:', operation);
    }
    
    // 验证操作类型
    if (!operation || !operation.type) {
      throw new Error('Invalid operation: missing type');
    }
    
    // 验证表定义
    if (!operation.table) {
      throw new Error('Invalid operation: missing table');
    }
    
    // 验证操作类型是否支持
    const supportedTypes = ['select', 'insert', 'update', 'delete'];
    if (!supportedTypes.includes(operation.type)) {
      throw new Error(`Unsupported operation type: ${operation.type}`);
    }
    
    return await this.dialect.query(operation);
  }

  // 执行 SQL（Drizzle AST）
  async executeSql(sql: SQL, table: PodTable): Promise<any[]> {
    if (this.options.logger) {
      console.log('Executing SQL AST:', sql);
    }
    
    return await this.dialect.executeSql(sql, table);
  }

  async executeComplexUpdate(
    table: PodTable,
    data: Record<string, any>,
    condition: QueryCondition
  ): Promise<any[]> {
    console.log('[PodAsyncSession] Executing complex update for table:', table.config.name);
    return await this.dialect.executeComplexUpdate(
      {
        type: 'update',
        table,
        data,
        where: condition
      } as PodOperation,
      condition
    );
  }

  async executeComplexDelete(
    table: PodTable,
    condition: QueryCondition
  ): Promise<any[]> {
    console.log('[PodAsyncSession] Executing complex delete for table:', table.config.name);
    return await this.dialect.executeComplexDelete(
      {
        type: 'delete',
        table,
        where: condition
      } as PodOperation,
      condition
    );
  }

  // SELECT 查询构建器
  select<TTable extends PodTable<any>>(fields?: SelectFieldMap) {
    return new SelectQueryBuilder<TTable>(this, fields);
  }

  // INSERT 查询构建器
  insert<TTable extends PodTable<any>>(table: TTable) {
    return new InsertQueryBuilder<TTable>(this, table);
  }

  // UPDATE 查询构建器
  update<TTable extends PodTable<any>>(table: TTable) {
    return new UpdateQueryBuilder<TTable>(this, table);
  }

  // DELETE 查询构建器
  delete<TTable extends PodTable<any>>(table: TTable) {
    return new DeleteQueryBuilder<TTable>(this, table);
  }

  // 事务支持
  async transaction<T>(
    transaction: (tx: PodAsyncSession) => Promise<T>
  ): Promise<T> {
    console.log('Starting transaction');
    try {
      const result = await transaction(this);
      console.log('Transaction completed successfully');
      return result;
    } catch (error) {
      console.error('Transaction failed:', error);
      throw error;
    }
  }
}

// SELECT 查询构建器 - 支持 Drizzle AST 和 JOIN
class SelectQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  public selectedTable?: TTable;
  public whereConditions?: Record<string, any>;
  private conditionTree?: QueryCondition;
  public sql?: SQL; // 存储 Drizzle SQL AST
  private joins: Array<{
    type: JoinType;
    table: PodTable<any>;
    alias: string;
    rawCondition: any;
    resolvedConditions?: ResolvedJoinCondition[];
  }> = [];
  private limitCount?: number;
  private offsetCount?: number;
  private orderByClauses: Array<{ column: string; direction: 'asc' | 'desc' }> = [];
  private isDistinct = false;
  private selectedFields?: SelectFieldMap;
  private tableAliases = new Map<PodTable<any>, string>();
  private aliasToTable = new Map<string, PodTable<any>>();
  private aliasUsage = new Map<string, number>();
  private primaryAlias?: string;
  private joinFilters: QueryCondition[] = [];
  private groupByColumns: ColumnReference[] = [];

  constructor(public session: PodAsyncSession, fields?: SelectFieldMap) {
    if (fields) {
      this.setSelectedFields(fields);
    }
  }

  from(table: TTable) {
    this.selectedTable = table;
    this.primaryAlias = this.ensureAliasForTable(table);
    return this;
  }

  columns(fields: SelectFieldMap) {
    this.setSelectedFields(fields);
    return this;
  }

  private setSelectedFields(fields: SelectFieldMap) {
    this.selectedFields = { ...fields };
  }

  where(conditions: Record<string, any> | SQL | QueryCondition) {
    if (conditions instanceof SQL) {
      // 如果是 SQL 对象，存储 AST
      this.sql = conditions;
    } else if (this.isQueryCondition(conditions)) {
      this.processQueryCondition(conditions);
    } else {
      this.processWhereObject(conditions);
    }
    return this;
  }

  private isQueryCondition(obj: any): obj is QueryCondition {
    return obj && typeof obj === 'object' && 'type' in obj && 'operator' in obj;
  }

  private convertQueryConditionToSimple(condition: QueryCondition): Record<string, any> {
    if (condition.type === 'binary_expr' && condition.operator === '=' && condition.column && condition.value !== undefined) {
      return { [condition.column]: condition.value };
    }

    if (condition.type === 'logical_expr' && condition.operator === 'AND' && condition.conditions) {
      const result: Record<string, any> = {};
      for (const child of condition.conditions) {
        const childResult = this.convertQueryConditionToSimple(child);
        if (!childResult || Object.keys(childResult).length === 0) {
          return {};
        }
        for (const [key, value] of Object.entries(childResult)) {
          result[key] = value;
        }
      }
      return result;
    }

    return {};
  }

  // JOIN 支持
  leftJoin<TJoinTable extends PodTable<any>>(
    table: TJoinTable, 
    condition: any
  ): SelectQueryBuilder<TTable> {
    return this.addJoin('leftJoin', table, condition);
  }

  rightJoin<TJoinTable extends PodTable<any>>(
    table: TJoinTable, 
    condition: any
  ): SelectQueryBuilder<TTable> {
    return this.addJoin('rightJoin', table, condition);
  }

  innerJoin<TJoinTable extends PodTable<any>>(
    table: TJoinTable, 
    condition: any
  ): SelectQueryBuilder<TTable> {
    return this.addJoin('innerJoin', table, condition);
  }

  fullJoin<TJoinTable extends PodTable<any>>(
    table: TJoinTable, 
    condition: any
  ): SelectQueryBuilder<TTable> {
    return this.addJoin('fullJoin', table, condition);
  }

  groupBy(...fields: Array<PodColumnBase | string>): SelectQueryBuilder<TTable> {
    const refs = fields.map((field) => this.resolveColumnReference(field));
    this.groupByColumns.push(...refs);
    return this;
  }

  private addJoin<TJoinTable extends PodTable<any>>(
    type: JoinType,
    table: TJoinTable,
    condition: any
  ): SelectQueryBuilder<TTable> {
    if (type === 'rightJoin' || type === 'fullJoin') {
      throw new Error(`${type} is not yet supported in Solid dialect`);
    }

    const alias = this.ensureAliasForTable(table);
    const resolvedConditions = this.resolveJoinConditions(condition, alias);

    this.joins.push({
      type,
      table,
      alias,
      rawCondition: condition,
      resolvedConditions
    });

    return this;
  }

  private ensureAliasForTable(table: PodTable<any>): string {
    const existing = this.tableAliases.get(table);
    if (existing) {
      return existing;
    }

    const baseName = table.config.name || 'table';
    const usage = this.aliasUsage.get(baseName) ?? 0;
    const nextUsage = usage + 1;
    this.aliasUsage.set(baseName, nextUsage);

    const alias = usage === 0 ? baseName : `${baseName}_${nextUsage}`;
    this.tableAliases.set(table, alias);
    this.aliasToTable.set(alias, table);
    return alias;
  }

  private resolveJoinConditions(condition: any, joinAlias: string): ResolvedJoinCondition[] {
    if (!condition || typeof condition !== 'object') {
      throw new Error('JOIN condition must be an object mapping columns');
    }

    const entries = Object.entries(condition);
    if (entries.length === 0) {
      throw new Error('JOIN condition cannot be empty');
    }

    return entries.map(([leftKey, rightKey]) => {
      const leftRef = this.resolveColumnReference(leftKey);
      const rightRef = this.resolveColumnReference(rightKey);

      if (leftRef.alias !== joinAlias && rightRef.alias !== joinAlias) {
        throw new Error('JOIN condition must reference the joined table in at least one side');
      }

      return { left: leftRef, right: rightRef };
    });
  }

  private resolveColumnReference(field: PodColumnBase | string, fallbackAlias?: string): ColumnReference {
    if (field instanceof PodColumnBase) {
      const table = field.table;
      if (!table) {
        throw new Error(`Column ${field.name} is not associated with a table`);
      }
      const alias = this.ensureAliasForTable(table);
      return { table, alias, column: field.name };
    }

    if (typeof field === 'string') {
      const { alias: parsedAlias, column } = this.parseColumnReferenceString(field);
      const alias = parsedAlias ?? fallbackAlias ?? this.primaryAlias;
      if (!alias) {
        throw new Error(`Unable to resolve table alias for column reference "${field}"`);
      }
      const table = this.aliasToTable.get(alias);
      if (!table) {
        throw new Error(`Unknown table alias "${alias}" in column reference "${field}"`);
      }
      return { table, alias, column };
    }

    throw new Error('Unsupported column reference type');
  }

  private parseColumnReferenceString(reference: string): { alias?: string; column: string } {
    const trimmed = reference.trim();
    if (!trimmed.includes('.')) {
      return { column: trimmed };
    }
    const [alias, column] = trimmed.split('.', 2);
    return { alias, column };
  }

  private processWhereObject(conditions?: Record<string, any>): void {
    if (!conditions) {
      return;
    }

    const baseConditions: Record<string, any> = { ...(this.whereConditions ?? {}) };

    for (const [rawKey, value] of Object.entries(conditions)) {
      const { alias, column } = this.parseColumnReferenceString(rawKey);
      const targetAlias = alias ?? this.primaryAlias;

      if (!targetAlias || targetAlias === this.primaryAlias || !this.aliasToTable.has(targetAlias)) {
        baseConditions[column] = value;
        continue;
      }

      this.joinFilters.push(this.createConditionFromLiteral(targetAlias, column, value));
    }

    this.whereConditions = Object.keys(baseConditions).length > 0 ? baseConditions : undefined;
  }

  private processQueryCondition(condition: QueryCondition): void {
    if (condition.table && condition.table !== this.primaryAlias) {
      this.joinFilters.push(condition);
      return;
    }

    this.conditionTree = condition;
    const simpleConditions = this.convertQueryConditionToSimple(condition);
    if (Object.keys(simpleConditions).length > 0) {
      this.whereConditions = simpleConditions;
    }
  }

  private createConditionFromLiteral(alias: string, column: string, value: any): QueryCondition {
    if (value === undefined) {
      return {
        type: 'unary_expr',
        operator: 'IS NULL',
        column,
        left: { column },
        table: alias
      };
    }

    if (value === null) {
      return {
        type: 'unary_expr',
        operator: 'IS NULL',
        column,
        left: { column },
        table: alias
      };
    }

    if (Array.isArray(value)) {
      return {
        type: 'binary_expr',
        operator: 'IN',
        column,
        left: { column },
        right: { value },
        value,
        table: alias
      };
    }

    return {
      type: 'binary_expr',
      operator: '=',
      column,
      left: { column },
      right: { value },
      value,
      table: alias
    };
  }

  limit(count: number) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('LIMIT must be a non-negative integer');
    }
    this.limitCount = count;
    return this;
  }

  offset(count: number) {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('OFFSET must be a non-negative integer');
    }
    this.offsetCount = count;
    return this;
  }

  orderBy(column: PodColumnBase | string, direction: 'asc' | 'desc' = 'asc') {
    const columnName = typeof column === 'string' ? column : column.name;
    if (!columnName) {
      throw new Error('ORDER BY requires a valid column name');
    }

    this.orderByClauses.push({ column: columnName, direction });
    return this;
  }

  distinct(enable = true) {
    this.isDistinct = enable;
    return this;
  }

  async execute(): Promise<InferTableData<TTable>[]> {
    if (!this.selectedTable) {
      throw new Error('No table specified for SELECT query');
    }

    if (this.sql) {
      // 使用 SQL AST 执行
      return await this.session.executeSql(this.sql, this.selectedTable) as InferTableData<TTable>[];
    } else {
      const wherePayload = this.conditionTree ?? this.whereConditions;
      const operation: PodOperation = {
        type: 'select',
        table: this.selectedTable,
        where: wherePayload,
        limit: this.limitCount,
        offset: this.offsetCount,
        orderBy: this.orderByClauses.length > 0 ? this.orderByClauses : undefined,
        distinct: this.isDistinct || undefined
      };

      const hasJoins = this.joins.length > 0;

      if (this.groupByColumns.length === 0 && this.hasMixedAggregateSelection()) {
        throw new Error('Mixed aggregate and non-aggregate selections require groupBy columns');
      }

      if (!hasJoins && !this.shouldUseAggregateFallback()) {
        if (this.selectedFields) {
          operation.select = this.selectedFields;
        }
        const directResults = await this.session.execute(operation) as Record<string, any>[];
        if (this.selectedFields) {
          return directResults.map((row) => this.projectSelectedRow(row)) as InferTableData<TTable>[];
        }
        return directResults as InferTableData<TTable>[];
      }

      if (hasJoins) {
        operation.select = undefined;
      } else if (!this.shouldUseAggregateFallback()) {
        operation.select = this.selectedFields;
      } else {
        operation.select = undefined;
      }

      let intermediateRows = await this.session.execute(operation) as Record<string, any>[];

      if (hasJoins) {
        intermediateRows = this.normalizeBaseRows(intermediateRows);
        intermediateRows = await this.applyJoinFallback(intermediateRows);
        intermediateRows = this.applyJoinFilters(intermediateRows);
      }

      if (this.shouldUseAggregateFallback()) {
        return this.handleAggregateFallback(intermediateRows) as InferTableData<TTable>[];
      }

      if (this.selectedFields) {
        return intermediateRows.map((row) => this.projectSelectedRow(row)) as InferTableData<TTable>[];
      }

      return intermediateRows as InferTableData<TTable>[];
    }
  }

  private projectSelectedRow(row: Record<string, any>): Record<string, any> {
    const projected: Record<string, any> = {};
    if (!this.selectedFields) {
      return row;
    }
    for (const key of Object.keys(this.selectedFields)) {
      const field = this.selectedFields[key];
      if (isAggregateExpression(field)) {
        projected[key] = row[key];
        continue;
      }

      let assigned = false;
      for (const candidate of this.resolveFieldBindingCandidates(key, field)) {
        if (row[candidate] !== undefined) {
          projected[key] = row[candidate];
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        projected[key] = row[key];
      }
    }
    return projected;
  }

  private resolveFieldBindingCandidates(alias: string, field: SelectField): string[] {
    const candidates = new Set<string>([alias]);

    if (typeof field === 'string') {
      const { alias: refAlias, column } = this.parseColumnReferenceString(field);
      candidates.add(field);
      candidates.add(column);
      if (refAlias) {
        candidates.add(`${refAlias}.${column}`);
      }
    } else if (field instanceof PodColumnBase) {
      const columnRef = this.resolveColumnReference(field);
      candidates.add(field.name);
      candidates.add(`${columnRef.alias}.${columnRef.column}`);
    } else if (field && typeof field === 'object') {
      const candidateName = (field as { name?: unknown }).name;
      if (typeof candidateName === 'string') {
        candidates.add(candidateName);
      }
    }

    return Array.from(candidates);
  }

  private shouldUseAggregateFallback(): boolean {
    if (this.groupByColumns.length > 0) {
      return true;
    }

    if (!this.selectedFields) {
      return false;
    }

    const fields = Object.values(this.selectedFields);
    return fields.length > 0 && fields.every((field) => isAggregateExpression(field));
  }

  private buildAggregateRow(rows: Record<string, any>[]): Record<string, any> {
    const result: Record<string, any> = {};
    if (!this.selectedFields) {
      return result;
    }

    for (const [alias, field] of Object.entries(this.selectedFields)) {
      if (!isAggregateExpression(field)) {
        continue;
      }
      result[alias] = this.computeAggregateValue(field, rows);
    }

    return result;
  }

  private computeAggregateValue(aggregate: AggregateExpression, rows: Record<string, any>[]): number | null {
    const columnRef = this.resolveAggregateColumnRef(aggregate);

    if (!columnRef) {
      if (aggregate.func === 'count') {
        return aggregate.distinct ? this.countDistinctRows(rows) : rows.length;
      }
      return null;
    }

    switch (aggregate.func) {
      case 'count': {
        const values = this.collectValuesForCount(columnRef, rows, !!aggregate.distinct);
        return values.length;
      }
      case 'sum': {
        const values = this.collectNumericValues(columnRef, rows, !!aggregate.distinct);
        if (values.length === 0) return null;
        return values.reduce((acc, value) => acc + value, 0);
      }
      case 'avg': {
        const values = this.collectNumericValues(columnRef, rows, !!aggregate.distinct);
        if (values.length === 0) return null;
        const total = values.reduce((acc, value) => acc + value, 0);
        return total / values.length;
      }
      case 'min': {
        const values = this.collectNumericValues(columnRef, rows, !!aggregate.distinct);
        if (values.length === 0) return null;
        return Math.min(...values);
      }
      case 'max': {
        const values = this.collectNumericValues(columnRef, rows, !!aggregate.distinct);
        if (values.length === 0) return null;
        return Math.max(...values);
      }
      default:
        return null;
    }
  }

  private resolveAggregateColumnRef(aggregate: AggregateExpression): ColumnReference | undefined {
    const column = aggregate.column;
    if (!column) {
      return undefined;
    }

    if (typeof column === 'string') {
      return this.resolveColumnReference(column);
    }

    if (column instanceof PodColumnBase) {
      return this.resolveColumnReference(column);
    }

    if (typeof column === 'object' && 'name' in (column as Record<string, unknown>)) {
      const candidate = (column as { name?: unknown }).name;
      if (typeof candidate === 'string') {
        return this.resolveColumnReference(candidate);
      }
    }

    return undefined;
  }

  private collectValuesForCount(column: ColumnReference, rows: Record<string, any>[], distinct: boolean): any[] {
    const values = rows
      .map((row) => this.getRowValueForColumn(row, column))
      .filter((value) => value !== undefined && value !== null);

    if (!distinct) {
      return values;
    }

    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const value of values) {
      const key = this.serializeValueForKey(value);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(value);
      }
    }
    return deduped;
  }

  private collectNumericValues(column: ColumnReference, rows: Record<string, any>[], distinct: boolean): number[] {
    const numbers: number[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const rawValue = this.getRowValueForColumn(row, column);
      if (rawValue === undefined || rawValue === null) {
        continue;
      }

      const numeric = Number(rawValue);
      if (Number.isNaN(numeric)) {
        continue;
      }

      if (distinct) {
        const key = this.serializeValueForKey(numeric);
        if (!seen.has(key)) {
          seen.add(key);
          numbers.push(numeric);
        }
      } else {
        numbers.push(numeric);
      }
    }

    return numbers;
  }

  private countDistinctRows(rows: Record<string, any>[]): number {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = this.serializeValueForKey(row);
      seen.add(key);
    }
    return seen.size;
  }

  private handleAggregateFallback(rows: Record<string, any>[]): Record<string, any>[] {
    if (!this.selectedFields) {
      if (this.groupByColumns.length === 0) {
        return rows;
      }

      const unique = new Map<string, Record<string, any>>();
      for (const row of rows) {
        const keyParts = this.groupByColumns.map((ref) => this.serializeValueForKey(this.getRowValueForColumn(row, ref)));
        const groupKey = JSON.stringify(keyParts);
        if (!unique.has(groupKey)) {
          unique.set(groupKey, row);
        }
      }
      return Array.from(unique.values());
    }

    if (this.groupByColumns.length === 0) {
      return [this.buildAggregateRow(rows)];
    }

    return this.buildGroupedAggregateRows(rows);
  }

  private buildGroupedAggregateRows(rows: Record<string, any>[]): Record<string, any>[] {
    if (!this.selectedFields) {
      return rows;
    }

    this.ensureGroupByValidity();

    const groups = new Map<string, { rows: Record<string, any>[]; first: Record<string, any> }>();

    for (const row of rows) {
      const keyParts = this.groupByColumns.map((ref) => this.serializeValueForKey(this.getRowValueForColumn(row, ref)));
      const groupKey = JSON.stringify(keyParts);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { rows: [], first: row });
      }
      groups.get(groupKey)?.rows.push(row);
    }

    const results: Record<string, any>[] = [];
    for (const { rows: groupRows, first } of groups.values()) {
      const aggregateValues = this.buildAggregateRow(groupRows);
      const projected: Record<string, any> = {};

      for (const [key, field] of Object.entries(this.selectedFields)) {
        if (isAggregateExpression(field)) {
          projected[key] = aggregateValues[key];
        } else {
          const columnRef = this.resolveSelectFieldColumn(field);
          projected[key] = columnRef ? this.getRowValueForColumn(first, columnRef) : undefined;
        }
      }

      results.push(projected);
    }

    return results;
  }

  private ensureGroupByValidity(): void {
    if (!this.selectedFields) {
      return;
    }

    const groupColumns = this.groupByColumns.map((ref) => `${ref.alias}.${ref.column}`);

    for (const field of Object.values(this.selectedFields)) {
      if (isAggregateExpression(field)) {
        continue;
      }
      const columnRef = this.resolveSelectFieldColumn(field);
      if (!columnRef) {
        continue;
      }
      const identifier = `${columnRef.alias}.${columnRef.column}`;
      if (!groupColumns.includes(identifier)) {
        throw new Error(`Column ${identifier} must appear in GROUP BY clause when mixed with aggregates`);
      }
    }
  }

  private resolveSelectFieldColumn(field: SelectField): ColumnReference | undefined {
    if (field instanceof PodColumnBase) {
      return this.resolveColumnReference(field);
    }

    if (typeof field === 'string') {
      return this.resolveColumnReference(field);
    }

    return undefined;
  }

  private hasMixedAggregateSelection(): boolean {
    if (!this.selectedFields) {
      return false;
    }
    const fields = Object.values(this.selectedFields);
    const hasAggregate = fields.some((field) => isAggregateExpression(field));
    const hasNonAggregate = fields.some((field) => !isAggregateExpression(field));
    return hasAggregate && hasNonAggregate;
  }

  private normalizeBaseRows(rows: Record<string, any>[]): Record<string, any>[] {
    if (!rows.length) {
      return rows;
    }

    const alias = this.primaryAlias || this.ensureAliasForTable(this.selectedTable!);

    return rows.map((row) => {
      const result: Record<string, any> = { ...row };
      for (const [key, value] of Object.entries(row)) {
        if (key === `${alias}.${key}`) {
          continue;
        }
        result[`${alias}.${key}`] = value;
      }

      const subjectValue = row.subject as string | undefined;
      if (subjectValue) {
        result[`${alias}.subject`] = subjectValue;
        const derivedId = this.extractIdFromSubject(subjectValue);
        if (derivedId !== undefined) {
          if (result.id === undefined) {
            result.id = derivedId;
          }
          result[`${alias}.id`] = derivedId;
        }
      }

      return result;
    });
  }

  private async applyJoinFallback(rows: Record<string, any>[]): Promise<Record<string, any>[]> {
    let combinedRows = rows;

    for (const join of this.joins) {
      const joinRows = await this.fetchJoinRows(join, combinedRows);
      combinedRows = this.mergeRowsWithJoin(combinedRows, join, joinRows);
    }

    return combinedRows;
  }

  private async fetchJoinRows(
    join: {
      type: JoinType;
      table: PodTable<any>;
      alias: string;
      resolvedConditions?: ResolvedJoinCondition[];
    },
    baseRows: Record<string, any>[]
  ): Promise<Record<string, any>[]> {
    const conditions = join.resolvedConditions ?? [];
    if (conditions.length === 0) {
      return [];
    }

    const [primaryCondition] = conditions;
    const joinRef = primaryCondition.left.alias === join.alias ? primaryCondition.left : primaryCondition.right;
    const baseRef = joinRef === primaryCondition.left ? primaryCondition.right : primaryCondition.left;

    const uniqueValues = new Map<string, any>();
    for (const row of baseRows) {
      const value = this.getRowValueForColumn(row, baseRef);
      if (value === undefined || value === null) {
        continue;
      }
      const key = this.serializeValueForKey(value);
      if (!uniqueValues.has(key)) {
        uniqueValues.set(key, value);
      }
    }

    if (uniqueValues.size === 0) {
      return [];
    }

    const valuesArray = Array.from(uniqueValues.values());

    const joinColumnInstance = join.table.getColumn(joinRef.column);
    let joinQuery = this.session.select().from(join.table);

    if (joinColumnInstance && joinRef.column !== 'id') {
      joinQuery = joinQuery.where(inArray(joinColumnInstance, valuesArray));
    }

    const joinRows = await joinQuery as Record<string, any>[];
    return this.normalizeJoinRows(join, joinRows);
  }

  private normalizeJoinRows(
    join: {
      alias: string;
      table: PodTable<any>;
    },
    rows: Record<string, any>[]
  ): Record<string, any>[] {
    return rows.map((row) => {
      const normalized: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[`${join.alias}.${key}`] = value;
      }

      const subjectValue = row.subject as string | undefined;
      if (subjectValue) {
        normalized[`${join.alias}.subject`] = subjectValue;
        const id = this.extractIdFromSubject(subjectValue);
        if (id !== undefined) {
          normalized[`${join.alias}.id`] = id;
        }
      }

      return normalized;
    });
  }

  private mergeRowsWithJoin(
    baseRows: Record<string, any>[],
    join: {
      type: JoinType;
      alias: string;
      table: PodTable<any>;
      resolvedConditions?: ResolvedJoinCondition[];
    },
    joinRows: Record<string, any>[]
  ): Record<string, any>[] {
    const conditions = join.resolvedConditions ?? [];
    if (conditions.length === 0) {
      return baseRows;
    }

    const [primaryCondition] = conditions;
    const joinRef = primaryCondition.left.alias === join.alias ? primaryCondition.left : primaryCondition.right;
    const baseRef = joinRef === primaryCondition.left ? primaryCondition.right : primaryCondition.left;

    const joinValueMap = new Map<string, Record<string, any>[]>();
    for (const joinRow of joinRows) {
      const value = this.getRowValueForColumn(joinRow, joinRef);
      if (value === undefined || value === null) {
        continue;
      }
      const key = this.serializeValueForKey(value);
      if (!joinValueMap.has(key)) {
        joinValueMap.set(key, []);
      }
      joinValueMap.get(key)!.push(joinRow);
    }

    const merged: Record<string, any>[] = [];
    for (const baseRow of baseRows) {
      const baseValue = this.getRowValueForColumn(baseRow, baseRef);
      const key = this.serializeValueForKey(baseValue);
      const matches = baseValue !== undefined && baseValue !== null ? joinValueMap.get(key) ?? [] : [];

      if (matches.length === 0) {
        if (join.type === 'innerJoin') {
          continue;
        }
        merged.push({ ...baseRow, ...this.createEmptyJoinRow(join) });
        continue;
      }

      for (const match of matches) {
        merged.push({ ...baseRow, ...match });
      }
    }

    return merged;
  }

  private createEmptyJoinRow(join: { alias: string; table: PodTable<any> }): Record<string, any> {
    const empty: Record<string, any> = {};
    for (const columnName of Object.keys(join.table.columns)) {
      empty[`${join.alias}.${columnName}`] = undefined;
    }
    empty[`${join.alias}.subject`] = undefined;
    empty[`${join.alias}.id`] = undefined;
    return empty;
  }

  private applyJoinFilters(rows: Record<string, any>[]): Record<string, any>[] {
    if (this.joinFilters.length === 0) {
      return rows;
    }

    return rows.filter((row) => this.joinFilters.every((condition) => this.evaluateCondition(row, condition)));
  }

  private evaluateCondition(row: Record<string, any>, condition: QueryCondition): boolean {
    switch (condition.type) {
      case 'binary_expr':
        return this.evaluateBinaryCondition(row, condition);
      case 'unary_expr':
        return this.evaluateUnaryCondition(row, condition);
      case 'logical_expr':
        return this.evaluateLogicalCondition(row, condition);
      default:
        return true;
    }
  }

  private evaluateBinaryCondition(row: Record<string, any>, condition: QueryCondition): boolean {
    if (!condition.column) {
      return true;
    }
    const columnRef = this.resolveColumnReference(`${condition.table ?? this.primaryAlias}.${condition.column}`);
    const value = this.getRowValueForColumn(row, columnRef);
    const target = condition.value;

    switch (condition.operator.toUpperCase()) {
      case '=':
        return value === target;
      case '!=':
      case '<>':
        return value !== target;
      case '>':
        return Number(value) > Number(target);
      case '>=':
        return Number(value) >= Number(target);
      case '<':
        return Number(value) < Number(target);
      case '<=':
        return Number(value) <= Number(target);
      case 'IN':
        return Array.isArray(target) && target.includes(value);
      case 'NOT IN':
        return Array.isArray(target) && !target.includes(value);
      case 'LIKE':
        return typeof value === 'string' && typeof target === 'string' && this.computeLikeMatch(value, target);
      default:
        return true;
    }
  }

  private evaluateUnaryCondition(row: Record<string, any>, condition: QueryCondition): boolean {
    if (!condition.column) {
      return true;
    }
    const columnRef = this.resolveColumnReference(`${condition.table ?? this.primaryAlias}.${condition.column}`);
    const value = this.getRowValueForColumn(row, columnRef);

    switch (condition.operator.toUpperCase()) {
      case 'IS NULL':
        return value === null || value === undefined;
      case 'IS NOT NULL':
        return value !== null && value !== undefined;
      case 'NOT':
        return !this.evaluateCondition(row, condition.left as QueryCondition);
      default:
        return true;
    }
  }

  private evaluateLogicalCondition(row: Record<string, any>, condition: QueryCondition): boolean {
    const children = condition.conditions ?? [];
    if (condition.operator.toUpperCase() === 'AND') {
      return children.every((child) => this.evaluateCondition(row, child));
    }
    if (condition.operator.toUpperCase() === 'OR') {
      return children.some((child) => this.evaluateCondition(row, child));
    }
    return true;
  }

  private getColumnKeyCandidates(column: ColumnReference): string[] {
    const candidates = [] as string[];
    const baseAlias = this.primaryAlias;
    if (column.alias === baseAlias) {
      candidates.push(column.column);
    }
    candidates.push(`${column.alias}.${column.column}`);
    return candidates;
  }

  private getRowValueForColumn(row: Record<string, any>, column: ColumnReference): any {
    const candidates = this.getColumnKeyCandidates(column);
    for (const key of candidates) {
      if (key in row) {
        return row[key];
      }
    }
    return undefined;
  }

  private serializeValueForKey(value: any): string {
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  private extractIdFromSubject(subject?: string): string | undefined {
    if (!subject) {
      return undefined;
    }
    const match = subject.match(/[^/#]+$/);
    return match ? match[0] : subject;
  }

  private computeLikeMatch(value: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
    return regex.test(value);
  }

  // 使查询构建器可等待
  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// INSERT 查询构建器 - 支持 Drizzle AST
class InsertQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  public insertValues?: InferInsertData<TTable> | InferInsertData<TTable>[];
  public sql?: SQL;

  constructor(
    public session: PodAsyncSession,
    public table: TTable
  ) {}

  values(values: InferInsertData<TTable> | InferInsertData<TTable>[] | SQL) {
    if (values instanceof SQL) {
      this.sql = values;
    } else {
      this.insertValues = values;
    }
    return this;
  }

  async execute(): Promise<InferTableData<TTable>[]> {
    if (this.sql) {
      // 使用 SQL AST 执行
      return await this.session.executeSql(this.sql, this.table) as InferTableData<TTable>[];
    } else if (this.insertValues) {
      // 使用简化操作
      const operation: PodOperation = {
        type: 'insert',
        table: this.table,
        values: this.insertValues
      };
      return await this.session.execute(operation) as InferTableData<TTable>[];
    } else {
      throw new Error('No values specified for INSERT query');
    }
  }

  // 使查询构建器可等待
  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// UPDATE 查询构建器 - 支持 Drizzle AST
class UpdateQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  public updateData?: InferUpdateData<TTable>;
  public whereConditions?: Record<string, any>;
  public sql?: SQL;
  private conditionTree?: QueryCondition;

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

  where(conditions: Record<string, any> | SQL | QueryCondition) {
    console.log('[UpdateQueryBuilder] where() received:', conditions);
    if (conditions instanceof SQL) {
      // 如果已有 SQL，需要合并（复杂情况）
      if (!this.sql) {
        this.sql = conditions;
      }
    } else if (this.isQueryCondition(conditions)) {
      // 如果是 QueryCondition 对象，转换为简单条件
      this.conditionTree = conditions;
      const simple = this.convertQueryConditionToSimple(conditions);
      this.whereConditions = Object.keys(simple).length > 0 ? simple : undefined;
    } else {
      this.whereConditions = conditions;
      this.conditionTree = undefined;
    }
    return this;
  }

  private isQueryCondition(obj: any): obj is QueryCondition {
    return obj && typeof obj === 'object' && 'type' in obj && 'operator' in obj;
  }

  private convertQueryConditionToSimple(condition: QueryCondition): Record<string, any> {
    if (condition.type === 'binary_expr' && condition.column && condition.value !== undefined) {
      return { [condition.column]: condition.value };
    }
    // 对于复杂条件，暂时返回空对象，后续可以扩展
    console.warn('Complex query conditions not yet supported, using empty condition');
    return {};
  }

  async execute(): Promise<any[]> {
    if (this.sql) {
      // 使用 SQL AST 执行
      return await this.session.executeSql(this.sql, this.table);
    } else if (this.updateData) {
      // 使用简化操作
      const operation: PodOperation = {
        type: 'update',
        table: this.table,
        data: this.updateData,
        where: this.whereConditions ?? this.conditionTree
      };

      if (this.conditionTree && (!this.whereConditions || Object.keys(this.whereConditions).length === 0)) {
        return await this.session.executeComplexUpdate(this.table, this.updateData, this.conditionTree);
      }

      return await this.session.execute(operation);
    } else {
      throw new Error('No data specified for UPDATE query');
    }
  }

  // 使查询构建器可等待
  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// DELETE 查询构建器 - 支持 Drizzle AST
class DeleteQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  public whereConditions?: Record<string, any>;
  public sql?: SQL;
  private conditionTree?: QueryCondition;

  constructor(
    public session: PodAsyncSession,
    public table: TTable
  ) {}

  where(conditions: Record<string, any> | SQL | QueryCondition) {
    if (conditions instanceof SQL) {
      this.sql = conditions;
    } else if (this.isQueryCondition(conditions)) {
      // 如果是 QueryCondition 对象，转换为简单条件
      this.conditionTree = conditions;
      const simple = this.convertQueryConditionToSimple(conditions);
      this.whereConditions = Object.keys(simple).length > 0 ? simple : undefined;
    } else {
      this.whereConditions = conditions;
      this.conditionTree = undefined;
    }
    return this;
  }

  private isQueryCondition(obj: any): obj is QueryCondition {
    return obj && typeof obj === 'object' && 'type' in obj && 'operator' in obj;
  }

  private convertQueryConditionToSimple(condition: QueryCondition): Record<string, any> {
    if (condition.type === 'binary_expr' && condition.column && condition.value !== undefined) {
      return { [condition.column]: condition.value };
    }
    // 对于复杂条件，暂时返回空对象，后续可以扩展
    console.warn('Complex query conditions not yet supported, using empty condition');
    return {};
  }

  async execute(): Promise<any[]> {
    if (this.sql) {
      // 使用 SQL AST 执行
      return await this.session.executeSql(this.sql, this.table);
    } else {
      // 使用简化操作
      const operation: PodOperation = {
        type: 'delete',
        table: this.table,
        where: this.whereConditions ?? this.conditionTree
      };

      if (this.conditionTree && (!this.whereConditions || Object.keys(this.whereConditions).length === 0)) {
        return await this.session.executeComplexDelete(this.table, this.conditionTree);
      }

      return await this.session.execute(operation);
    }
  }

  // 使查询构建器可等待
  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
