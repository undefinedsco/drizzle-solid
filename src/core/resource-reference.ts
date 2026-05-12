import type { PodTable } from './schema';

type AnyPodTable = PodTable<any> & {
  getResourcePath?: () => string;
  getSubjectTemplate?: () => string;
};

export interface PodResourceReference {
  resourceId: string;
  templateValues: Record<string, string>;
}

function parseTemplateVariableField(token: string): string {
  return token.split('|').map((part) => part.trim()).filter(Boolean)[0] ?? token;
}

function normalizeResourcePath(path: string): string {
  return path.trim().replace(/^(\.\/)+/, '');
}

function tableResourcePath(table: AnyPodTable): string {
  return normalizeResourcePath(table.getResourcePath?.() ?? table.config?.base ?? '');
}

function tableSubjectTemplate(table: AnyPodTable): string {
  return table.getSubjectTemplate?.() ?? table.config?.subjectTemplate ?? '{id}';
}

function isPlainId(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !value.includes('#');
}

function relativeSubjectFromRef(table: AnyPodTable, ref: string): string | null {
  const resourcePath = tableResourcePath(table);
  if (!resourcePath) return null;

  if (isPlainId(ref)) {
    return ref;
  }

  const candidates = Array.from(new Set([
    resourcePath,
    resourcePath.replace(/^\/+/, ''),
    resourcePath.endsWith('/') ? resourcePath.slice(0, -1) : resourcePath,
  ].filter(Boolean)));

  for (const candidate of candidates) {
    const index = ref.indexOf(candidate);
    if (index < 0) continue;
    let relative = ref.slice(index + candidate.length);
    if (relative.startsWith('/')) relative = relative.slice(1);
    if (relative.length > 0) return relative;
  }

  return null;
}

function extractTemplateValues(relativeSubject: string, template: string): Record<string, string> | null {
  if (!template.includes('{')) {
    return relativeSubject === template ? {} : null;
  }

  let groupIndex = 0;
  const groupToField = new Map<string, string>();
  let regexText = template
    .replace(/[.+?^$[\]\\()]/g, '\\$&')
    .replace(/\{([^}]+)\}/g, (_match, token) => {
      const groupName = `var${groupIndex++}`;
      groupToField.set(groupName, parseTemplateVariableField(token));
      return `(?<${groupName}>.+?)`;
    });
  regexText = `^${regexText}$`;

  try {
    const match = relativeSubject.match(new RegExp(regexText));
    if (!match?.groups) return null;

    const values: Record<string, string> = {};
    for (const [groupName, value] of Object.entries(match.groups)) {
      const field = groupToField.get(groupName);
      if (!field || value === undefined) continue;
      const decoded = decodeURIComponent(value);
      if (field in values && values[field] !== decoded) return null;
      values[field] = decoded;
    }
    return values;
  } catch {
    return null;
  }
}

export function parsePodResourceRef(table: AnyPodTable, ref: string | null | undefined): PodResourceReference | null {
  if (!ref) return null;

  if (isPlainId(ref)) {
    return {
      resourceId: ref,
      templateValues: { id: ref },
    };
  }

  const relativeSubject = relativeSubjectFromRef(table, ref);
  if (!relativeSubject) return null;

  const templateValues = extractTemplateValues(relativeSubject, tableSubjectTemplate(table)) ?? {};
  return {
    resourceId: decodeURIComponent(relativeSubject),
    templateValues,
  };
}

export function extractPodResourceTemplateValue(
  table: AnyPodTable,
  ref: string | null | undefined,
  field = 'id',
): string | null {
  return parsePodResourceRef(table, ref)?.templateValues[field] ?? null;
}
