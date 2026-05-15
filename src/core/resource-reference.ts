import type { PodTable } from './schema';

type AnyPodResource = PodTable<any> & {
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

function podResourcePath(resource: AnyPodResource): string {
  return normalizeResourcePath(resource.getResourcePath?.() ?? resource.config?.base ?? '');
}

function podResourceSubjectTemplate(resource: AnyPodResource): string {
  return resource.getSubjectTemplate?.() ?? resource.config?.subjectTemplate ?? '{id}';
}

function resourceRelativePrefix(resource: AnyPodResource): string {
  const resourcePath = podResourcePath(resource);
  const containerPath = normalizeResourcePath(resource.getContainerPath?.() ?? resource.config?.containerPath ?? '');

  if (!resourcePath) {
    return '';
  }

  if (containerPath && resourcePath.startsWith(containerPath)) {
    return normalizeResourcePath(resourcePath.slice(containerPath.length));
  }

  return resourcePath.split('/').pop() ?? resourcePath;
}

function qualifyFragmentResourceId(resource: AnyPodResource, relativeSubject: string): string {
  if (!relativeSubject.startsWith('#')) {
    return relativeSubject;
  }

  const prefix = resourceRelativePrefix(resource);
  return prefix ? `${prefix}${relativeSubject}` : relativeSubject;
}

function templateRelativeSubject(resource: AnyPodResource, resourceId: string): string {
  const template = podResourceSubjectTemplate(resource);
  if (template.startsWith('#') && !resourceId.startsWith('#')) {
    const hashIndex = resourceId.indexOf('#');
    if (hashIndex >= 0) {
      return resourceId.slice(hashIndex);
    }
  }
  return resourceId;
}

function isBaseRelativeSubjectId(value: string): boolean {
  if (!value || /^https?:\/\//.test(value) || value.startsWith('/')) {
    return false;
  }

  return (
    value.startsWith('#') ||
    value.includes('#') ||
    /\.(ttl|jsonld|json)(?:#|$)/i.test(value)
  );
}

function relativeSubjectFromRef(resource: AnyPodResource, ref: string): string | null {
  const resourcePath = podResourcePath(resource);
  if (!resourcePath) return null;

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

  if (isBaseRelativeSubjectId(ref)) {
    return normalizeResourcePath(ref);
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

export function parsePodResourceRef(resource: AnyPodResource, ref: string | null | undefined): PodResourceReference | null {
  if (!ref) return null;

  const relativeSubject = relativeSubjectFromRef(resource, ref);
  if (!relativeSubject) return null;

  const resourceId = qualifyFragmentResourceId(resource, relativeSubject);
  const templateValues = extractTemplateValues(templateRelativeSubject(resource, resourceId), podResourceSubjectTemplate(resource));
  if (!templateValues) return null;

  return {
    resourceId: decodeURIComponent(resourceId),
    templateValues,
  };
}

export function extractPodResourceTemplateValue(
  resource: AnyPodResource,
  ref: string | null | undefined,
  field = 'id',
): string | null {
  return parsePodResourceRef(resource, ref)?.templateValues[field] ?? null;
}
