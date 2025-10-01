// 编译时类型推断系统
// 使用 TypeScript 的编译时类型检查，而不是运行时推断

import { podTable, string, int, bool, date } from './pod-table';
import { PodTable, PodTableOptions } from './pod-table';

// 类型安全的字段定义
export interface TypedField<T extends string> {
  name: T;
  predicate: string;
  type: 'string' | 'number' | 'boolean' | 'Date';
}

// 类型安全的表定义
export type TypedTableDefinition<T extends Record<string, TypedField<any>>> = {
  [K in keyof T]: T[K];
};

// 从类型定义创建实际的表
export function createTypedTable<T extends Record<string, TypedField<any>>>(
  name: string,
  definition: TypedTableDefinition<T>,
  options: PodTableOptions
): PodTable {
  const columns: Record<string, any> = {};
  
  for (const [fieldName, fieldDef] of Object.entries(definition)) {
    switch (fieldDef.type) {
      case 'string':
        columns[fieldName] = string(fieldName).predicate(fieldDef.predicate);
        break;
      case 'number':
        columns[fieldName] = int(fieldName).predicate(fieldDef.predicate);
        break;
      case 'boolean':
        columns[fieldName] = bool(fieldName).predicate(fieldDef.predicate);
        break;
      case 'Date':
        columns[fieldName] = date(fieldName).predicate(fieldDef.predicate);
        break;
    }
  }
  
  return podTable(name, columns, options);
}

// 类型安全的字段创建函数
export function field<T extends string>(
  name: T,
  predicate: string,
  type: 'string' | 'number' | 'boolean' | 'Date'
): TypedField<T> {
  return { name, predicate, type };
}

// 预定义的常用字段
export const CommonFields = {
  name: (predicate: string = 'https://schema.org/name') => 
    field('name', predicate, 'string'),
  email: (predicate: string = 'https://schema.org/email') => 
    field('email', predicate, 'string'),
  age: (predicate: string = 'https://schema.org/age') => 
    field('age', predicate, 'number'),
  dateCreated: (predicate: string = 'https://schema.org/dateCreated') => 
    field('dateCreated', predicate, 'Date'),
  isActive: (predicate: string = 'https://schema.org/isActive') => 
    field('isActive', predicate, 'boolean'),
  url: (predicate: string = 'https://schema.org/url') => 
    field('url', predicate, 'string'),
  description: (predicate: string = 'https://schema.org/description') => 
    field('description', predicate, 'string'),
  identifier: (predicate: string = 'https://schema.org/identifier') => 
    field('identifier', predicate, 'string')
} as const;

// 类型安全的表构建器
export class TypedTableBuilder<T extends Record<string, TypedField<any>>> {
  private definition: T = {} as T;
  
  constructor(private name: string, private options: PodTableOptions) {}
  
  // 添加字段
  addField<K extends string>(
    fieldDef: TypedField<K>
  ): TypedTableBuilder<T & Record<K, TypedField<K>>> {
    this.definition[fieldDef.name] = fieldDef as any;
    return this as any;
  }
  
  // 构建表
  build(): PodTable {
    return createTypedTable(this.name, this.definition, this.options);
  }
}

// 创建类型安全的表构建器
export function typedTable(name: string, options: PodTableOptions) {
  return new TypedTableBuilder(name, options);
}

// 类型安全的查询结果类型
export type TypedTableResult<T extends Record<string, TypedField<any>>> = {
  [K in keyof T]: T[K] extends TypedField<infer U> 
    ? T[K]['type'] extends 'string' ? string
    : T[K]['type'] extends 'number' ? number
    : T[K]['type'] extends 'boolean' ? boolean
    : T[K]['type'] extends 'Date' ? Date
    : never
    : never;
};
