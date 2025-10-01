import { z } from 'zod';
import { PodTable, InferTableData, InferInsertData, InferUpdateData, PodColumn } from './pod-table';

/**
 * 从 PodTable 生成 Zod 模式
 * 支持 drizzle-zod 集成
 */
export function createTableSchema<TTable extends PodTable<any>>(
  table: TTable, 
  customValidations?: Record<string, z.ZodTypeAny>
) {
  const schemaFields: Record<string, z.ZodTypeAny> = {};

  for (const [columnName, column] of Object.entries(table.columns)) {
    const podColumn = column as PodColumn;
    const columnType = podColumn.dataType;
    const options = podColumn.options;

    let zodType: z.ZodTypeAny;

    // 检查是否有自定义验证
    if (customValidations && customValidations[columnName]) {
      zodType = customValidations[columnName];
    } else {
      // 根据列类型创建对应的 Zod 类型
      switch (columnType) {
        case 'string':
          zodType = z.string();
          break;
        case 'integer':
          zodType = z.number().int();
          break;
        case 'boolean':
          zodType = z.boolean();
          break;
        case 'datetime':
          zodType = z.date();
          break;
        case 'json':
          zodType = z.any(); // JSON 可以是任何类型
          break;
        case 'object':
          zodType = z.record(z.string(), z.any()); // Object 是键值对
          break;
        default:
          zodType = z.any();
      }
    }

    // 处理可选性
    if (options.primaryKey || !options.required) {
      zodType = zodType.optional();
    }

    // 处理默认值
    if (options.defaultValue !== undefined) {
      zodType = zodType.default(options.defaultValue);
    }

    schemaFields[columnName] = zodType;
  }

  return z.object(schemaFields);
}

/**
 * 创建插入数据的 Zod 模式
 * 主键字段可选，必需字段必填
 */
export function createInsertSchema<TTable extends PodTable<any>>(table: TTable) {
  const schemaFields: Record<string, z.ZodTypeAny> = {};

  for (const [columnName, column] of Object.entries(table.columns)) {
    const podColumn = column as PodColumn;
    const columnType = podColumn.dataType;
    const options = podColumn.options;

    let zodType: z.ZodTypeAny;

    // 根据列类型创建对应的 Zod 类型
    switch (columnType) {
      case 'string':
        zodType = z.string();
        break;
      case 'integer':
        zodType = z.number().int();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'datetime':
        zodType = z.date();
        break;
      case 'json':
        zodType = z.any();
        break;
      case 'object':
        zodType = z.record(z.string(), z.any());
        break;
      default:
        zodType = z.any();
    }

    // 插入时：主键可选，必需字段必填，可选字段可选
    if (options.primaryKey || !options.required) {
      zodType = zodType.optional();
    }

    // 处理默认值
    if (options.defaultValue !== undefined) {
      zodType = zodType.default(options.defaultValue);
    }

    schemaFields[columnName] = zodType;
  }

  return z.object(schemaFields);
}

/**
 * 创建更新数据的 Zod 模式
 * 所有字段都是可选的
 */
export function createUpdateSchema<TTable extends PodTable<any>>(table: TTable) {
  const schemaFields: Record<string, z.ZodTypeAny> = {};

  for (const [columnName, column] of Object.entries(table.columns)) {
    const podColumn = column as PodColumn;
    const columnType = podColumn.dataType;

    let zodType: z.ZodTypeAny;

    // 根据列类型创建对应的 Zod 类型
    switch (columnType) {
      case 'string':
        zodType = z.string();
        break;
      case 'integer':
        zodType = z.number().int();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'datetime':
        zodType = z.date();
        break;
      case 'json':
        zodType = z.any();
        break;
      case 'object':
        zodType = z.record(z.string(), z.any());
        break;
      default:
        zodType = z.any();
    }

    // 更新时所有字段都是可选的
    schemaFields[columnName] = zodType.optional();
  }

  return z.object(schemaFields);
}

/**
 * 类型安全的表模式创建器
 * 提供完整的类型推断支持
 */
export class TableSchemaBuilder<TTable extends PodTable<any>> {
  private customValidations: Record<string, z.ZodTypeAny> = {};

  constructor(private table: TTable) {}

  /**
   * 创建完整的表模式
   */
  get schema() {
    return createTableSchema(this.table, this.customValidations);
  }

  /**
   * 获取完整的表模式（兼容性方法）
   */
  getSchema() {
    return this.schema;
  }

  /**
   * 创建插入模式
   */
  get insert() {
    return createInsertSchema(this.table);
  }

  /**
   * 创建更新模式
   */
  get update() {
    return createUpdateSchema(this.table);
  }

  /**
   * 添加自定义验证
   */
  addValidation(columnName: string, validation: z.ZodTypeAny) {
    this.customValidations[columnName] = validation;
    return this;
  }

  /**
   * 验证表数据
   */
  validate(data: unknown): InferTableData<TTable> {
    return this.schema.parse(data) as InferTableData<TTable>;
  }

  /**
   * 验证插入数据
   */
  validateInsert(data: unknown): InferInsertData<TTable> {
    return this.insert.parse(data) as InferInsertData<TTable>;
  }

  /**
   * 验证更新数据
   */
  validateUpdate(data: unknown): InferUpdateData<TTable> {
    return this.update.parse(data) as InferUpdateData<TTable>;
  }

  /**
   * 安全解析表数据（不抛出异常）
   */
  safeValidate(data: unknown) {
    return this.schema.safeParse(data);
  }

  /**
   * 安全解析插入数据（不抛出异常）
   */
  safeValidateInsert(data: unknown) {
    return this.insert.safeParse(data);
  }

  /**
   * 安全解析更新数据（不抛出异常）
   */
  safeValidateUpdate(data: unknown) {
    return this.update.safeParse(data);
  }
}

/**
 * 为表创建 Zod 模式构建器
 */
export function getTableSchema<TTable extends PodTable<any>>(table: TTable): TableSchemaBuilder<TTable> {
  return new TableSchemaBuilder(table);
}

/**
 * 直接获取表的 Zod schema（兼容性函数）
 */
export function getTableSchemaDirect<TTable extends PodTable<any>>(table: TTable) {
  return createTableSchema(table);
}