import type { PodTable } from '../schema';

export interface DefaultIdTemplateOptions {
  key: string;
  row?: Record<string, unknown>;
  now?: Date;
  resource?: PodTable<any>;
  links?: Record<string, PodTable<any>>;
}

export function renderDefaultIdTemplate(
  template: string,
  options: DefaultIdTemplateOptions
): string {
  if (!/\{[^{}]+\}/.test(template)) {
    return template;
  }
  if (/\{\s*id\s*\}/.test(template)) {
    throw new Error('id default template uses {key} for the generated local key; {id} is the final resource id');
  }

  const row = options.row ?? {};
  const date = resolveDate(row, options.now);
  const dateParts = {
    yyyy: String(date.getUTCFullYear()),
    MM: String(date.getUTCMonth() + 1).padStart(2, '0'),
    dd: String(date.getUTCDate()).padStart(2, '0'),
  };

  return template.replace(/\{([^{}]+)\}/g, (_placeholder, rawExpression: string) => {
    const expression = rawExpression.trim();
    if (expression === 'key') return options.key;
    if (expression === 'yyyy') return dateParts.yyyy;
    if (expression === 'MM') return dateParts.MM;
    if (expression === 'dd') return dateParts.dd;

    const value = resolveExpression(expression, row, options);
    return value === null || value === undefined ? '' : String(value);
  });
}

function resolveDate(row: Record<string, unknown>, now = new Date()): Date {
  const source = row.createdAt ?? row.favoredAt ?? row.indexedAt ?? now;
  const date = source instanceof Date
    ? source
    : new Date(typeof source === 'number' && Math.abs(source) < 100_000_000_000 ? source * 1000 : source as any);
  return Number.isFinite(date.getTime()) ? date : now;
}

function resolveExpression(
  expression: string,
  row: Record<string, unknown>,
  options: DefaultIdTemplateOptions,
): unknown {
  const parsed = parseExpression(expression);
  let value = resolveTemplatePath(parsed.path, row, options);

  for (const transform of parsed.transforms) {
    value = applyTransform(value, transform, parsed.path, options);
  }

  return parsed.selector
    ? applyPathSelector(value, parsed.selector)
    : value;
}

function parseExpression(expression: string): {
  path: string;
  transforms: string[];
  selector?: string;
} {
  const selectorMatch = expression.match(/^(.+?)\[(.*)\]$/);
  const source = selectorMatch ? selectorMatch[1].trim() : expression;
  const [path, ...transforms] = source
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    path: path ?? expression,
    transforms,
    selector: selectorMatch?.[2]?.trim(),
  };
}

function resolveTemplatePath(
  path: string,
  row: Record<string, unknown>,
  options: DefaultIdTemplateOptions,
): unknown {
  const parts = path.split('.');
  const root = parts[0];

  return parts.reduce<unknown>((current, part, index) => {
    if (typeof current === 'string') {
      return part === 'id' && root
        ? extractResourceId(current, root, options)
        : undefined;
    }
    if (!current || typeof current !== 'object') return undefined;
    if (part === 'id' && root && !('id' in current)) {
      return extractResourceId(current, root, options);
    }
    if (index > 0 && part === 'id') {
      const ref = readRef(current);
      if (ref) return extractResourceId(current, root ?? '', options);
    }
    return (current as Record<string, unknown>)[part];
  }, row);
}

function applyTransform(
  value: unknown,
  transform: string,
  field: string,
  options: DefaultIdTemplateOptions,
): unknown {
  if (transform === 'slug') {
    return slugifyValue(String(value ?? ''));
  }

  const resourceId = extractResourceId(value, field, options);

  if (transform === 'resource') {
    return resourceId;
  }

  if (transform === 'document') {
    return resourceId?.split('#')[0] ?? '';
  }

  if (transform === 'owner') {
    return resourceId ? deriveOwnerDir(resourceId) : '';
  }

  const values = extractTemplateValuesForField(value, field, options);
  if (transform === 'id') {
    return values?.id ?? values?.key ?? resourceId ?? '';
  }

  return values?.[transform] ?? '';
}

function extractResourceId(
  value: unknown,
  field: string,
  options: DefaultIdTemplateOptions,
): string | null {
  const ref = readRef(value);
  if (!ref) return null;
  const resource = resolveLinkedResource(field, options);
  if (!resource) return normalizePodDataResourceId(ref);

  if (!isCompleteResourceId(ref)) {
    return renderLinkedResourceId(resource, ref);
  }

  const relative = relativeSubjectFromRef(resource, ref);
  return normalizePodDataResourceId(relative ?? ref);
}

function extractTemplateValuesForField(
  value: unknown,
  field: string,
  options: DefaultIdTemplateOptions,
): Record<string, string> | null {
  const ref = readRef(value);
  if (!ref) return null;
  const resource = resolveLinkedResource(field, options);
  if (!resource) return null;

  const relative = relativeSubjectFromRef(resource, ref);
  if (!relative) return null;

  const template = resourceTemplate(resource);
  if (!template) {
    return { id: normalizePodDataResourceId(relative) };
  }

  return extractVarsFromTemplate(normalizePodDataResourceId(relative), template);
}

function resolveLinkedResource(field: string, options: DefaultIdTemplateOptions): PodTable<any> | null {
  const direct = options.links?.[field];
  if (direct) return direct;

  const column = options.resource?.columns?.[field] as any;
  return column?.getLinkTable?.() ?? column?.options?.linkTable ?? null;
}

function resourceTemplate(resource: PodTable<any>): string | null {
  const subjectTemplate = resource.getSubjectTemplate?.() ?? resource.config?.subjectTemplate;
  if (subjectTemplate) return subjectTemplate;

  const defaultValue = (resource.columns?.id as any)?.options?.defaultValue;
  return typeof defaultValue === 'string' ? defaultValue : null;
}

function renderLinkedResourceId(resource: PodTable<any>, localId: string): string {
  const template = resourceTemplate(resource);
  if (!template) return localId;

  const defaultValue = (resource.columns?.id as any)?.options?.defaultValue;
  if (typeof defaultValue === 'function') {
    return String(defaultValue(localId, {}));
  }

  return template.replace(/\{([^}]+)\}/g, (_match, token) => {
    const field = parseTemplateField(token);
    return field === 'id' || field === 'key' ? localId : '';
  });
}

function readRef(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const ref = record['@id'] ?? record.subject ?? record.id;
  return typeof ref === 'string' && ref.length > 0 ? ref : null;
}

function resourcePath(resource: PodTable<any>): string {
  return normalizeResourcePath(resource.getResourcePath?.() ?? resource.config?.base ?? '');
}

function relativeSubjectFromRef(resource: PodTable<any>, ref: string): string | null {
  const path = resourcePath(resource);
  if (!path) return normalizePodDataResourceId(ref);

  const candidates = Array.from(new Set([
    path,
    path.replace(/^\/+/, ''),
    path.endsWith('/') ? path.slice(0, -1) : path,
  ].filter(Boolean)));

  for (const candidate of candidates) {
    const index = ref.indexOf(candidate);
    if (index < 0) continue;
    let relative = ref.slice(index + candidate.length);
    if (relative.startsWith('/')) relative = relative.slice(1);
    return relative.length > 0 ? relative : null;
  }

  return normalizePodDataResourceId(ref);
}

function extractVarsFromTemplate(relativePath: string, template: string): Record<string, string> | null {
  let groupIndex = 0;
  const groupToField = new Map<string, string>();
  const parts: string[] = [];
  let cursor = 0;
  for (const match of template.matchAll(/\{([^}]+)\}/g)) {
    parts.push(escapeRegExp(template.slice(cursor, match.index)));
    const groupName = `var${groupIndex++}`;
    groupToField.set(groupName, parseTemplateField(match[1] ?? ''));
    parts.push(`(?<${groupName}>.+?)`);
    cursor = match.index + match[0].length;
  }
  parts.push(escapeRegExp(template.slice(cursor)));
  const regex = parts.join('');

  try {
    const match = relativePath.match(new RegExp(`^${regex}$`));
    if (!match?.groups) return null;
    const values: Record<string, string> = {};
    for (const [groupName, value] of Object.entries(match.groups)) {
      const field = groupToField.get(groupName);
      if (!field || value === undefined) continue;
      values[field] = decodeURIComponent(value);
    }
    return values;
  } catch {
    return null;
  }
}

function parseTemplateField(token: string): string {
  const expression = token.split('|').map((part) => part.trim()).filter(Boolean)[0] ?? token;
  const withoutSelector = expression.replace(/\[[^\]]*\]$/u, '').trim();
  return withoutSelector.split('.')[0]?.trim() || withoutSelector || expression;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function applyPathSelector(value: unknown, selector: string): unknown {
  const segments = splitResourcePath(value);
  if (!segments) return undefined;

  if (/^-?\d+$/.test(selector)) {
    return segments[normalizeIndex(Number(selector), segments.length)];
  }

  const slice = selector.match(/^(-?\d*)\s*:\s*(-?\d*)$/);
  if (!slice) {
    throw new Error(`Invalid id default path selector [${selector}]`);
  }

  const start = slice[1] === '' ? 0 : normalizeSliceIndex(Number(slice[1]), segments.length);
  const end = slice[2] === '' ? segments.length : normalizeSliceIndex(Number(slice[2]), segments.length);
  return segments.slice(start, end).join('/');
}

function splitResourcePath(value: unknown): string[] | null {
  const ref = readRef(value);
  if (!ref) return null;
  const normalized = normalizePodDataResourceId(ref);
  const [document, fragment] = normalized.split('#');
  const parts = (document ?? normalized).split('/').filter(Boolean);
  if (fragment) parts.push(fragment);
  return parts;
}

function normalizePodDataResourceId(ref: string): string {
  const hashIndex = ref.indexOf('#');
  const [documentRef, fragment = ''] = hashIndex >= 0
    ? [ref.slice(0, hashIndex), ref.slice(hashIndex)]
    : [ref, ''];
  const dataIndex = documentRef.indexOf('/.data/');
  const relative = dataIndex >= 0
    ? documentRef.slice(dataIndex + '/.data/'.length)
    : documentRef.replace(/^\/?\.data\//u, '').replace(/^\/+/u, '');
  return `${relative}${fragment}`;
}

function normalizeResourcePath(path: string): string {
  return path.trim().replace(/^(\.\/)+/, '');
}

function isCompleteResourceId(value: string): boolean {
  return (
    /^https?:\/\//u.test(value)
    || value.startsWith('/')
    || value.startsWith('#')
    || value.includes('#')
    || /\.(ttl|jsonld|json)(?:$|[?#])/iu.test(value)
  );
}

function deriveOwnerDir(resourceId: string): string {
  const normalized = normalizePodDataResourceId(resourceId);
  const hashIndex = normalized.indexOf('#');
  const document = hashIndex >= 0 ? normalized.slice(0, hashIndex) : normalized;
  const fragment = hashIndex >= 0 ? normalized.slice(hashIndex + 1) : '';

  const dated = document.match(/^(.+)\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.(?:ttl|jsonld|json)$/i);
  if (dated?.[1]) return dated[1];

  if (document === 'task/index.ttl' && fragment && fragment !== 'this') {
    return `task/${fragment}`;
  }

  const index = document.match(/^(.+)\/index\.(?:ttl|jsonld|json)$/i);
  if (index?.[1]) return index[1];

  const doc = document.match(/^(.+)\.(?:ttl|jsonld|json)$/i);
  if (doc?.[1]) return doc[1];

  const parts = document.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : document;
}

function slugifyValue(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}.-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeIndex(index: number, length: number): number {
  return index < 0 ? length + index : index;
}

function normalizeSliceIndex(index: number, length: number): number {
  const normalized = index < 0 ? length + index : index;
  return Math.max(0, Math.min(length, normalized));
}
