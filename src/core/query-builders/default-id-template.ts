export interface DefaultIdTemplateOptions {
  key: string;
  row?: Record<string, unknown>;
  now?: Date;
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

    const value = resolveExpression(expression, row);
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

function resolveExpression(expression: string, row: Record<string, unknown>): unknown {
  const match = expression.match(/^(.+?)\[(.*)\]$/);
  if (!match) {
    return resolvePath(expression, row);
  }

  const value = resolvePath(match[1].trim(), row);
  return applyPathSelector(value, match[2].trim());
}

function resolvePath(path: string, row: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, row);
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
  if (typeof value !== 'string' || value.length === 0) return null;
  const withoutHash = value.split('#')[0] ?? value;
  return withoutHash.split('/').filter(Boolean);
}

function normalizeIndex(index: number, length: number): number {
  return index < 0 ? length + index : index;
}

function normalizeSliceIndex(index: number, length: number): number {
  const normalized = index < 0 ? length + index : index;
  return Math.max(0, Math.min(length, normalized));
}
