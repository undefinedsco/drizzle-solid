/**
 * Basic definitions and interfaces for Drizzle Solid Schema.
 */

// NanoID-like ID Generator (URL-friendly, cryptographically strong)
const urlAlphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
export const generateNanoId = (size = 21): string => {
  let id = '';
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(size));
    for (let i = 0; i < size; i++) {
      id += urlAlphabet[bytes[i] % urlAlphabet.length];
    }
  } else {
    console.warn("Using Math.random fallback for NanoID generation.");
    for (let i = 0; i < size; i++) {
      id += urlAlphabet[Math.floor(Math.random() * 256) % urlAlphabet.length];
    }
  }
  return id;
};

export interface NamespaceConfig {
  prefix: string;
  uri: string;
}

export type ColumnBuilderDataType = 'string' | 'integer' | 'datetime' | 'boolean' | 'json' | 'object' | 'array' | 'uri';

export type RdfTermInput = string | { value: string } | { term?: { value: string } };

export const hasStringValue = (input: unknown): input is { value: string } =>
  typeof input === 'object' && input !== null && typeof (input as Record<string, unknown>).value === 'string';

export const hasTermValue = (input: unknown): input is { term: { value: string } } =>
  typeof input === 'object' && input !== null &&
  typeof (input as Record<string, unknown>).term === 'object' &&
  (input as Record<string, { value?: string }>).term !== null &&
  typeof (input as Record<string, { value?: string }>).term?.value === 'string';

export const resolveTermIri = (input: RdfTermInput): string => {
  if (typeof input === 'string') return input;
  if (hasStringValue(input)) return input.value;
  if (hasTermValue(input)) return input.term.value;
  throw new Error('Term must be a string or VocabTerm with a string value');
};

export interface PodColumnOptions {
  primaryKey?: boolean;
  required?: boolean;
  defaultValue?: unknown;
  predicate?: string;
  linkTarget?: string;
  linkTableName?: string;
  linkTable?: any; // Forward reference to PodTable
  notNull?: boolean;
  baseType?: ColumnBuilderDataType;
  isArray?: boolean;
  inverse?: boolean;
}

export interface SolidSession {
  info: {
    isLoggedIn: boolean;
    webId?: string;
    sessionId?: string;
  };
  fetch: typeof globalThis.fetch;
}

export interface HookContext {
  session: SolidSession;
  table: any; // Forward reference to PodTable
  db: any;
}

export interface TableHooks {
  afterInsert?: (ctx: HookContext, record: Record<string, unknown>) => Promise<void>;
  afterUpdate?: (ctx: HookContext, record: Record<string, unknown>, changes: Record<string, unknown>) => Promise<void>;
  afterDelete?: (ctx: HookContext, record: Record<string, unknown>) => Promise<void>;
}

export interface PodTableOptions {
  base?: string;
  sparqlEndpoint?: string;
  type: RdfTermInput;
  namespace?: NamespaceConfig;
  typeIndex?: 'private' | 'public';
  saiRegistryPath?: string;
  subClassOf?: RdfTermInput | RdfTermInput[];
  subjectTemplate?: string;
  resourceMode?: 'ldp' | 'sparql';
  autoRegister?: boolean;
  hooks?: TableHooks;
}

export type SolidSchemaOptions = Omit<PodTableOptions, 'base' | 'hooks'>;

export interface InstantiateTableOptions extends Omit<PodTableOptions, 'type' | 'base'> {
  base: string;
}

export interface PodColumnMapping {
  column: string;
  predicate: string;
  kind: 'datatype' | 'object';
  datatype?: string;
  linkTarget?: string;
  isArray?: boolean;
  inverse?: boolean;
}

export interface PodTableMapping {
  name: string;
  type: string;
  subjectTemplate: string;
  namespace?: NamespaceConfig;
  subClassOf?: string[];
  columns: Record<string, PodColumnMapping>;
  relations?: Record<string, any>;
}
