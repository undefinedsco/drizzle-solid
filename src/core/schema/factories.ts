import { PodColumnOptions, generateNanoId } from './defs';
import { ColumnBuilder, PodStringColumn } from './columns';

export function boolean(name: string, options: PodColumnOptions = {}): ColumnBuilder<'boolean'> {
  return new ColumnBuilder(name, 'boolean', options);
}

export function timestamp(name: string, options: PodColumnOptions = {}): ColumnBuilder<'datetime'> {
  return new ColumnBuilder(name, 'datetime', options);
}

export function json(name: string, options: PodColumnOptions = {}): ColumnBuilder<'json'> {
  return new ColumnBuilder(name, 'json', options);
}

export function object(name: string, options: PodColumnOptions = {}): ColumnBuilder<'object'> {
  return new ColumnBuilder(name, 'object', options);
}

export function uri(name: string, options: PodColumnOptions = {}): ColumnBuilder<'uri'> {
  return new ColumnBuilder(name, 'uri', options);
}

export function iri(name: string, options: PodColumnOptions = {}): ColumnBuilder<'uri'> {
  return uri(name, options);
}

export function id(name = 'id', options: PodColumnOptions = {}): PodStringColumn {
  const col = new PodStringColumn(name, { 
    ...options, 
    predicate: '@id', 
    primaryKey: true, 
    required: true,
    defaultValue: options.defaultValue ?? generateNanoId 
  });
  (col as any)._virtualId = true;
  return col;
}

export function string(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function int(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function integer(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function date(name: string, options: PodColumnOptions = {}): ColumnBuilder<'datetime'> {
  return new ColumnBuilder(name, 'datetime', options);
}

export function datetime(name: string, options: PodColumnOptions = {}): ColumnBuilder<'datetime'> {
  return new ColumnBuilder(name, 'datetime', options);
}

export function text(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function varchar(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function char(name: string, options: PodColumnOptions = {}): ColumnBuilder<'string'> {
  return new ColumnBuilder(name, 'string', options);
}

export function bigint(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function smallint(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function tinyint(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function mediumint(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function serial(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function real(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function decimal(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function numeric(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function float(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function double(name: string, options: PodColumnOptions = {}): ColumnBuilder<'integer'> {
  return new ColumnBuilder(name, 'integer', options);
}

export function jsonb(name: string, options: PodColumnOptions = {}): ColumnBuilder<'json'> {
  return new ColumnBuilder(name, 'json', options);
}
