import { entityKind, SQL } from 'drizzle-orm';
import { PodTable, PodColumnBase, InferTableData } from '../pod-table';
import { QueryCondition, inArray } from '../query-conditions';
import { AggregateExpression, isAggregateExpression } from '../aggregates';
import { PodOperation } from '../pod-dialect';
import { SelectQueryPlan } from '../select-plan';
import {
  SelectField, SelectFieldMap, JoinType, ColumnReference, ResolvedJoinCondition, SessionInterface
} from './types';
import { createLiteralCondition, buildConditionTreeFromObject } from './helpers';
import { UriResolverImpl } from '../uri';

export class SelectQueryBuilder<TTable extends PodTable<any> = PodTable<any>> {
  static readonly [entityKind] = 'SelectQueryBuilder';

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

  constructor(public session: SessionInterface, fields?: SelectFieldMap) {
    if (fields) {
      this.setSelectedFields(fields);
    }
  }

  from<TJoinTable extends PodTable<any>>(table: TJoinTable): SelectQueryBuilder<TJoinTable> {
    this.selectedTable = table as unknown as TTable;
    this.primaryAlias = this.ensureAliasForTable(table);
    return this as unknown as SelectQueryBuilder<TJoinTable>;
  }

  columns(fields: SelectFieldMap) {
    this.setSelectedFields(fields);
    return this;
  }

  private setSelectedFields(fields: SelectFieldMap) {
    this.selectedFields = { ...fields };
  }

  /**
   * Add WHERE conditions to the query
   * 
   * Note: Using '@id' directly in conditions is deprecated.
   * Use db.findByIri(table, iri) for IRI-based lookups instead.
   */
  where(conditions: Record<string, any> | SQL | QueryCondition) {
    if (conditions instanceof SQL) {
      this.sql = conditions;
    } else if (this.isQueryCondition(conditions)) {
      this.processQueryCondition(conditions);
    } else {
      // Check for @id usage and warn/reject
      if (conditions && typeof conditions === 'object' && '@id' in conditions) {
        throw new Error(
          `Using '@id' in where() is not supported. ` +
          `Use db.findByIri(table, iri) for IRI-based lookups, ` +
          `or use { id: 'value' } for id-based lookups.`
        );
      }
      this.processWhereObject(conditions);
    }
    return this;
  }

  /**
   * Internal method that allows @id in conditions.
   * Used by *ByIri methods internally.
   * @internal
   */
  whereByIri(iri: string | string[]) {
    this.processWhereObject({ '@id': iri });
    return this;
  }

  private isQueryCondition(obj: any): obj is QueryCondition {
    return obj && typeof obj === 'object' && 'type' in obj && 'operator' in obj;
  }

  private convertQueryConditionToSimple(condition: QueryCondition): Record<string, any> {
    if (condition.type === 'binary_expr') {
      const left = (condition as any).left;
      const right = (condition as any).right;
      const op = (condition as any).operator;
      const colName = typeof left === 'string' ? left : left?.name;
      if (op === '=' && colName && right !== undefined) {
        return { [colName]: right };
      }
    }

    if (condition.type === 'logical_expr') {
      const op = (condition as any).operator;
      const exprs = (condition as any).expressions;
      if (op === 'AND' && exprs) {
        const result: Record<string, any> = {};
        for (const child of exprs) {
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
    }

    return {};
  }

  private extractTableFromCondition(condition: QueryCondition): string | undefined {
    // For BinaryExpression, check if 'left' has a table reference
    if (condition.type === 'binary_expr') {
      const left = (condition as any).left;
      if (left && typeof left === 'object' && 'table' in left) {
        // left.table is a PodTable object, get its alias from our map
        const tableObj = left.table;
        if (tableObj) {
          // Return the alias for this table from our tableAliases map
          const alias = this.tableAliases.get(tableObj);
          return alias;
        }
      }
      // Check for alias.column string format
      if (typeof left === 'string' && left.includes('.')) {
        return left.split('.')[0];
      }
    }
    return undefined;
  }

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

    const entries = Object.entries(condition) as Array<[string, string | PodColumnBase]>;
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

      this.joinFilters.push(createLiteralCondition(targetAlias, column, value));
    }

    this.whereConditions = Object.keys(baseConditions).length > 0 ? baseConditions : undefined;
  }

  private processQueryCondition(condition: QueryCondition): void {
    // Check if condition targets a joined table by examining the 'left' property
    const condTable = this.extractTableFromCondition(condition);
    if (condTable && condTable !== this.primaryAlias) {
      this.joinFilters.push(condition);
      return;
    }

    this.conditionTree = condition;
    const simpleConditions = this.convertQueryConditionToSimple(condition);
    if (Object.keys(simpleConditions).length > 0) {
      this.whereConditions = simpleConditions;
    }
  }

  private normalizeWhereConditions(): QueryCondition | undefined {
    if (this.conditionTree) {
      return this.conditionTree;
    }
    const alias = this.primaryAlias ?? this.selectedTable?.config.name;
    return buildConditionTreeFromObject(this.whereConditions, alias);
  }

  public toIR(): SelectQueryPlan {
    const wherePayload = this.normalizeWhereConditions();
    return this.buildQueryPlan(wherePayload);
  }

  private buildQueryPlan(whereCondition?: QueryCondition): SelectQueryPlan {
    if (!this.selectedTable) {
      throw new Error('No table specified for SELECT query');
    }

    const planJoins = this.joins.map((join) => ({
      type: join.type,
      table: join.table,
      alias: join.alias,
      conditions: (join.resolvedConditions ?? []).map(({ left, right }) => ({
        left,
        right
      }))
    }));

    return {
      baseTable: this.selectedTable,
      baseAlias: this.primaryAlias ?? this.selectedTable.config.name,
      select: this.selectedFields,
      selectAll: !this.selectedFields,
      where: this.whereConditions,
      conditionTree: whereCondition,
      joins: planJoins.length > 0 ? planJoins : undefined,
      joinFilters: this.joinFilters.length > 0 ? [...this.joinFilters] : undefined,
      groupBy: this.groupByColumns.length > 0 ? [...this.groupByColumns] : undefined,
      orderBy: this.orderByClauses.length > 0
        ? this.orderByClauses.map((clause) => ({
            rawColumn: clause.column,
            direction: clause.direction
          }))
        : undefined,
      distinct: this.isDistinct || undefined,
      limit: this.limitCount,
      offset: this.offsetCount,
      aliasToTable: new Map(this.aliasToTable),
      tableToAlias: new Map(this.tableAliases)
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
      return await this.session.executeSql(this.sql, this.selectedTable) as InferTableData<TTable>[];
    } else {
      const plan = this.toIR();
      const wherePayload = plan.conditionTree;
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
      const useAggregateFallback = this.shouldUseAggregateFallback();

      if (hasJoins || useAggregateFallback) {
        plan.select = undefined;
        plan.selectAll = true;
      }
      operation.plan = plan;

      if (this.groupByColumns.length === 0 && this.hasMixedAggregateSelection()) {
        throw new Error('Mixed aggregate and non-aggregate selections require groupBy columns');
      }

      let intermediateRows: Record<string, any>[];
      if (!hasJoins && !useAggregateFallback) {
        if (this.selectedFields) {
          operation.select = this.selectedFields;
        }
        intermediateRows = await this.session.execute(operation) as Record<string, any>[];
        intermediateRows = this.applySubjectMetadata(intermediateRows);
      } else {
        if (hasJoins) {
          operation.select = undefined;
        } else if (!useAggregateFallback) {
          operation.select = this.selectedFields;
        } else {
          operation.select = undefined;
        }

        intermediateRows = await this.session.execute(operation) as Record<string, any>[];
        if (!hasJoins) {
          intermediateRows = this.applySubjectMetadata(intermediateRows);
        }

        if (hasJoins) {
          intermediateRows = this.normalizeBaseRows(intermediateRows);
          intermediateRows = await this.applyJoinFallback(intermediateRows);
          intermediateRows = this.applyJoinFilters(intermediateRows);
        }
      }

      if (useAggregateFallback) {
        return this.handleAggregateFallback(intermediateRows) as InferTableData<TTable>[];
      }

      let finalRows = intermediateRows;

      if (!hasJoins) {
        finalRows = this.mergeRowsBySubject(finalRows);
      }

      if (this.selectedTable) {
        finalRows = await this.hydrateInlineColumns(finalRows, this.selectedTable);
      }

      if (this.selectedFields) {
        finalRows = finalRows.map((row) => this.projectSelectedRow(row));
      }

      finalRows = this.mergeRowsBySubject(finalRows);

      return finalRows as InferTableData<TTable>[];
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
    // GROUP BY is handled at SPARQL level (both LDP/Comunica and SPARQL endpoint support it)
    if (this.groupByColumns.length > 0) {
      return false;
    }

    // For pure aggregate queries (no GROUP BY), Comunica seems to have issues with multiple aggregates
    // So we use JS fallback for these cases
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

  private applySubjectMetadata(rows: Record<string, any>[]): Record<string, any>[] {
    return rows.map((row) => this.attachSubjectMetadata(row));
  }

  private attachSubjectMetadata(row: Record<string, any>): Record<string, any> {
    const subjectValue =
      typeof row.subject === 'object' && row.subject && 'value' in row.subject
        ? (row.subject as any).value
        : row.subject;
    if (typeof subjectValue === 'string' && subjectValue.length > 0) {
      if (row['@id'] === undefined) {
        row['@id'] = subjectValue;
      }
      if (row.uri === undefined) {
        row.uri = subjectValue;
      }
      if (row.id === undefined) {
        const derivedId = this.extractIdFromSubject(subjectValue, this.selectedTable);
        if (derivedId !== undefined) {
          row.id = derivedId;
        }
      }
    }
    return row;
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
        result.subject = subjectValue;
        result['@id'] = subjectValue;
        result.uri = subjectValue;
        result[`${alias}.subject`] = subjectValue;
        result[`${alias}.@id`] = subjectValue;
        result[`${alias}.uri`] = subjectValue;
        const derivedId = this.extractIdFromSubject(subjectValue, this.selectedTable);
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

  private async hydrateInlineColumns(
    rows: Record<string, any>[],
    table: PodTable<any>
  ): Promise<Record<string, any>[]> {
    if (!rows.length) {
      return rows;
    }
    rows = this.mergeRowsBySubject(rows);
    const inlineColumns = (Object.values(table.columns ?? {}) as PodColumnBase[]).filter((col) =>
      this.isInlineObjectColumn(col)
    );
    if (inlineColumns.length === 0) {
      return rows;
    }

    const predicateToColumn = new Map<string, PodColumnBase>();
    inlineColumns.forEach((col) => {
      const predicate = col.getPredicate(table.config.namespace as any);
      predicateToColumn.set(predicate, col);
    });

    const parentIris = Array.from(
      new Set(
        rows
          .map((row) =>
            this.normalizeInlineIri(row['@id'] ?? row.subject ?? row.uri ?? row.id)
          )
          .filter((v): v is string => !!v)
      )
    );

    if (parentIris.length === 0 || predicateToColumn.size === 0) {
      return rows;
    }

    const parentClause = parentIris.map((iri) => `<${iri}>`).join(' ');
    const predicateClause = Array.from(predicateToColumn.keys())
      .map((p) => `<${p}>`)
      .join(' ');
    const sourceUrl = this.inferSourceFromChild(parentIris[0], table);
    const sparql = {
      type: 'SELECT' as const,
      query: `SELECT ?parent ?linkPred ?child ?pred ?obj WHERE {
  VALUES ?parent { ${parentClause} }
  VALUES ?linkPred { ${predicateClause} }
  ?parent ?linkPred ?child .
  OPTIONAL { ?child ?pred ?obj . }
}`,
      prefixes: {}
    };

    const executor = this.session.getDialect().getSPARQLExecutor();
    const resultBindings = await executor.executeQueryWithSource(sparql, sourceUrl);

    const inlineNamespace = table.config.namespace?.uri ?? (table.config.namespace as any);
    const parentMap = new Map<string, Map<string, string[]>>();
    const childMap = new Map<string, Record<string, any>>();
    resultBindings.forEach((binding: any) => {
      const parentIri = this.normalizeInlineIri(binding.parent);
      const linkPred = this.normalizeInlineIri(binding.linkPred);
      const childIri = this.normalizeInlineIri(binding.child);
      const pred = this.normalizeInlineIri(binding.pred);
      const obj = this.normalizeInlineObjectValue(binding.obj);
      if (!parentIri || !linkPred) return;
      const column = predicateToColumn.get(linkPred);
      if (column) {
        const perParent = parentMap.get(parentIri) ?? new Map<string, string[]>();
        const list = perParent.get(column.name) ?? [];
        if (childIri && !list.includes(childIri)) {
          list.push(childIri);
        }
        perParent.set(column.name, list);
        parentMap.set(parentIri, perParent);
      }
      if (!childIri || !pred) return;
      const child = childMap.get(childIri) ?? { '@id': childIri, id: this.extractIdFromSubject(childIri, table) };
      const key = inlineNamespace && pred.startsWith(inlineNamespace) ? pred.slice(inlineNamespace.length) : pred;
      if (obj === undefined) {
        childMap.set(childIri, child);
        return;
      }
      const existing = child[key];
      if (existing === undefined) {
        child[key] = obj;
      } else if (Array.isArray(existing)) {
        child[key] = [...existing, obj];
      } else {
        child[key] = [existing, obj];
      }
      childMap.set(childIri, child);
    });

    const fallbackNormalize = (value: any): string[] => {
      if (Array.isArray(value)) {
        return value.map((entry) => this.normalizeInlineIri(entry)).filter((v): v is string => !!v);
      }
      const single = this.normalizeInlineIri(value);
      return single ? [single] : [];
    };

    const hydrateValue = (parentKey: string | undefined, raw: any, column: any): any => {
      const irisFromParent = parentKey ? parentMap.get(parentKey)?.get(column.name) ?? [] : [];
      const iris = irisFromParent.length > 0 ? irisFromParent : fallbackNormalize(raw);
      const objects = iris.map((iri) => childMap.get(iri) ?? { '@id': iri, id: this.extractIdFromSubject(iri, table) });
      if (column.dataType === 'array') {
        return objects;
      }
      return objects[0] ?? null;
    };

    rows.forEach((row) => {
      const parentKey = this.normalizeInlineIri(row['@id'] ?? row.subject ?? row.uri ?? row.id);
      inlineColumns.forEach((col) => {
        (row as any)[col.name] = hydrateValue(parentKey, (row as any)[col.name], col);
      });
    });

    return rows;
  }

  private normalizeInlineObjectValue(value: any): any {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'object' && 'value' in value) {
      const term: any = value;
      return term.value ?? undefined;
    }
    return value;
  }

  private normalizeInlineIri(value: any): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof value['@id'] === 'string') return value['@id'];
    if (typeof value === 'object' && typeof value.id === 'string' && value.id.includes('http')) return value.id;
    if (typeof value === 'object' && typeof value.value === 'string') return value.value;
    return undefined;
  }

  private mergeRowsBySubject(rows: Record<string, any>[]): Record<string, any>[] {
    const merged = new Map<string, Record<string, any>>();
    const order: string[] = [];
    rows.forEach((row) => {
      const key =
        this.normalizeInlineIri(row['@id']) ??
        this.normalizeInlineIri(row.subject) ??
        this.normalizeInlineIri(row.uri) ??
        (typeof row.id === 'string' ? row.id : undefined);
      if (process.env.DEBUG_INLINE_MERGE === '1') {
        console.log('mergeRowsBySubject key', key);
      }
      if (!key) {
        order.push(`__anon_${order.length}`);
        merged.set(order[order.length - 1], { ...row });
        return;
      }
      if (!merged.has(key)) {
        merged.set(key, { ...row });
        order.push(key);
        return;
      }
      const target = merged.get(key)!;
      const normalizeValueKey = (val: unknown): string => {
        if (val instanceof Date) return `date:${val.toISOString()}`;
        if (typeof val === 'string') return `str:${val}`;
        if (typeof val === 'number') return `num:${val}`;
        if (typeof val === 'boolean') return `bool:${val}`;
        if (val === null || val === undefined) return 'nil';
        try {
          return `obj:${JSON.stringify(val)}`;
        } catch {
          return `obj:${String(val)}`;
        }
      };

      Object.entries(row).forEach(([col, value]) => {
        if (value === undefined) return;
        const existing = target[col];
        if (existing === undefined) {
          target[col] = value;
          return;
        }
        const existingArr = Array.isArray(existing) ? existing : [existing];
        const incomingArr = Array.isArray(value) ? value : [value];
        const combined = [...existingArr];
        incomingArr.forEach((entry) => {
          const entryKey = normalizeValueKey(entry);
          if (!combined.some((item) => normalizeValueKey(item) === entryKey)) {
            combined.push(entry);
          }
        });

        const colDef = this.selectedTable?.columns[col];
        const isArrayType = colDef?.options?.isArray || (colDef as any)?.dataType === 'array';

        if (!isArrayType && combined.length > 1) {
            console.warn(`[Data Integrity] Multiple values found for single-value column '${col}' on subject '${key}'. Using first value.`);
            target[col] = combined[0];
        } else {
            // If array type, always return array. If unknown/implicit, fallback to auto-collapse.
            if (isArrayType) {
              target[col] = combined;
            } else {
              target[col] = combined.length === 1 ? combined[0] : combined;
            }
        }
      });
    });
    const result = order.map((key) => merged.get(key)!);
    return result;
  }

  private inferSourceFromChild(childIri: string, table: PodTable<any>): string {
    if (!childIri) {
      return this.session.getDialect().getPodUrl();
    }
    const hashIndex = childIri.indexOf('#');
    if (hashIndex > 0) {
      return childIri.slice(0, hashIndex);
    }
    const resourcePath = table.getResourcePath?.() || table.config.base || table.getContainerPath?.();
    if (resourcePath) {
      const absolute = resourcePath.startsWith('http')
        ? resourcePath
        : `${this.session.getDialect().getPodUrl()}${resourcePath.replace(/^\//, '')}`;
      return absolute;
    }
    return this.session.getDialect().getPodUrl();
  }

  private isInlineObjectColumn(column: PodColumnBase): boolean {
    if (!column) return false;
    if (column.dataType === 'object') return true;
    if (column.dataType === 'array') {
      const elementType = (column as any).elementType ?? column.options?.baseType;
      return elementType === 'object';
    }
    return false;
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
        normalized.subject = subjectValue;
        normalized['@id'] = subjectValue;
        normalized.uri = subjectValue;
        normalized[`${join.alias}.subject`] = subjectValue;
        normalized[`${join.alias}.@id`] = subjectValue;
        normalized[`${join.alias}.uri`] = subjectValue;
        const id = this.extractIdFromSubject(subjectValue, join.table);
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
    const left = (condition as any).left;
    const right = (condition as any).right;
    const op = (condition as any).operator;

    if (!left) {
      return true;
    }

    // Extract column name and table alias from left
    let colName: string;
    let tableAlias: string | undefined;
    if (typeof left === 'string') {
      if (left.includes('.')) {
        [tableAlias, colName] = left.split('.');
      } else {
        colName = left;
      }
    } else if (left && typeof left === 'object') {
      colName = left.name;
      tableAlias = left.table;
    } else {
      return true;
    }

    const columnRef = this.resolveColumnReference(`${tableAlias ?? this.primaryAlias}.${colName}`);
    const value = this.getRowValueForColumn(row, columnRef);
    const target = right;

    switch (op.toUpperCase()) {
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
    const op = (condition as any).operator;
    const val = (condition as any).value;

    // For NOT operator, value is another condition
    if (op.toUpperCase() === 'NOT') {
      return !this.evaluateCondition(row, val as QueryCondition);
    }

    // For IS NULL / IS NOT NULL, value is the column reference
    if (!val) {
      return true;
    }

    let colName: string;
    let tableAlias: string | undefined;
    if (typeof val === 'string') {
      if (val.includes('.')) {
        [tableAlias, colName] = val.split('.');
      } else {
        colName = val;
      }
    } else if (val && typeof val === 'object' && 'name' in val) {
      colName = val.name;
      tableAlias = val.table;
    } else {
      return true;
    }

    const columnRef = this.resolveColumnReference(`${tableAlias ?? this.primaryAlias}.${colName}`);
    const rowValue = this.getRowValueForColumn(row, columnRef);

    switch (op.toUpperCase()) {
      case 'IS NULL':
        return rowValue === null || rowValue === undefined;
      case 'IS NOT NULL':
        return rowValue !== null && rowValue !== undefined;
      default:
        return true;
    }
  }

  private evaluateLogicalCondition(row: Record<string, any>, condition: QueryCondition): boolean {
    const op = (condition as any).operator;
    const children = (condition as any).expressions ?? [];
    if (op.toUpperCase() === 'AND') {
      return children.every((child: QueryCondition) => this.evaluateCondition(row, child));
    }
    if (op.toUpperCase() === 'OR') {
      return children.some((child: QueryCondition) => this.evaluateCondition(row, child));
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

  private extractIdFromSubject(subject?: string, table?: PodTable<any>): string | undefined {
    if (!subject) {
      return undefined;
    }

    // Use UriResolver for proper document/fragment mode handling
    if (table) {
      const dialect = this.session.getDialect?.();
      const resolver = dialect?.getUriResolver?.() ?? new UriResolverImpl();
      const parsed = resolver.parseSubject(subject, table);
      if (parsed && parsed.id) {
        return parsed.id;
      }
    }

    // Fallback when no table: try fragment first, then filename
    const hashIndex = subject.indexOf('#');
    if (hashIndex !== -1) {
      const fragment = subject.slice(hashIndex + 1);
      if (fragment.length > 0) {
        return fragment;
      }
    }

    // Try filename extraction
    const lastSlash = subject.lastIndexOf('/');
    if (lastSlash !== -1) {
      let filename = subject.slice(lastSlash + 1);
      const extIndex = filename.lastIndexOf('.');
      if (extIndex !== -1) {
        filename = filename.slice(0, extIndex);
      }
      if (filename.length > 0) {
        return filename;
      }
    }

    return undefined;
  }

  private computeLikeMatch(value: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
    return regex.test(value);
  }


  async selectIdsByCondition(table: PodTable, condition: QueryCondition): Promise<string[]> {
    const builder = this.session.select({ id: table.getColumn('id') ?? table.columns.id })
      .from(table)
      .where(condition)
      .columns({ '@id': table.columns.id });
    const rows = await builder;
    return rows
      .map((row: any) => row.id || row['@id'])
      .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);
  }

  // 使查询构建器可等待
  then<TResult1 = Awaited<ReturnType<SelectQueryBuilder<TTable>['execute']>>, TResult2 = never>(
    onfulfilled?: ((value: Awaited<ReturnType<SelectQueryBuilder<TTable>['execute']>>) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
