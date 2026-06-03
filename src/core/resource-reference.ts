import type { PodTable } from './schema';
import { renderDefaultIdTemplate } from './query-builders/default-id-template';

type AnyPodResource = PodTable<any> & {
  resolveUri?: (id: string) => string;
  getResourcePath?: () => string;
  getSubjectTemplate?: () => string | undefined;
  columns?: {
    id?: {
      options?: {
        defaultValue?: unknown;
      };
    };
  };
};

export interface PodResourceReference {
  resourceId: string;
  templateValues: Record<string, string>;
}

export type PodResourceTarget = string | Record<string, unknown>;

function parseTemplateVariableField(token: string): string {
  const expression = token.split('|').map((part) => part.trim()).filter(Boolean)[0] ?? token;
  const withoutSelector = expression.replace(/\[[^\]]*\]$/u, '').trim();
  return withoutSelector.split('.')[0]?.trim() || withoutSelector || expression;
}

function normalizeResourcePath(path: string): string {
  return path.trim().replace(/^(\.\/)+/, '');
}

function podResourcePath(resource: AnyPodResource): string {
  return normalizeResourcePath(resource.getResourcePath?.() ?? resource.config?.base ?? '');
}

function podResourceSubjectTemplate(resource: AnyPodResource): string | undefined {
  return resource.getSubjectTemplate?.() ?? resource.config?.subjectTemplate;
}

function podResourceIdDefaultTemplate(resource: AnyPodResource): string | undefined {
  const defaultValue = resource.columns?.id?.options?.defaultValue;
  return typeof defaultValue === 'string' ? defaultValue : undefined;
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
  const template = podResourceSubjectTemplate(resource) ?? podResourceIdDefaultTemplate(resource);
  if (template?.startsWith('#') && !resourceId.startsWith('#')) {
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
  const parts: string[] = [];
  let cursor = 0;
  for (const match of template.matchAll(/\{([^}]+)\}/g)) {
    parts.push(escapeRegExp(template.slice(cursor, match.index)));
    const groupName = `var${groupIndex++}`;
    groupToField.set(groupName, parseTemplateVariableField(match[1] ?? ''));
    parts.push(`(?<${groupName}>.+?)`);
    cursor = match.index + match[0].length;
  }
  parts.push(escapeRegExp(template.slice(cursor)));
  const regexText = `^${parts.join('')}$`;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function parsePodResourceRef(resource: AnyPodResource, ref: string | null | undefined): PodResourceReference | null {
  if (!ref) return null;

  const relativeSubject = relativeSubjectFromRef(resource, ref);
  if (!relativeSubject) return null;

  const resourceId = qualifyFragmentResourceId(resource, relativeSubject);
  const template = podResourceSubjectTemplate(resource) ?? podResourceIdDefaultTemplate(resource);
  const templateValues = template
    ? extractTemplateValues(templateRelativeSubject(resource, resourceId), template)
    : { id: decodeURIComponent(resourceId) };
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

export function resolvePodBaseUrl(webIdOrPodUrl: string): string {
  const value = webIdOrPodUrl.trim();
  if (!value) return '';
  if (value.includes('/profile/card#me')) {
    return value.replace('/profile/card#me', '').replace(/\/+$/u, '');
  }
  return value.replace(/\/+$/u, '');
}

export function resolvePodBaseUrlFromDatabase(database: unknown): string | null {
  if (!database || typeof database !== 'object') return null;
  const db = database as {
    getDialect?: () => unknown;
    getSession?: () => unknown;
    session?: unknown;
  };
  const dialect = typeof db.getDialect === 'function' ? db.getDialect() : null;
  const dialectPodUrl = readPodUrl(dialect);
  if (dialectPodUrl) return resolvePodBaseUrl(dialectPodUrl);

  const session = typeof db.getSession === 'function' ? db.getSession() : db.session;
  const sessionPodUrl = readPodUrl(session);
  if (sessionPodUrl) return resolvePodBaseUrl(sessionPodUrl);

  const webId = readWebId(session);
  return webId && webId.includes('/profile/card#me')
    ? resolvePodBaseUrl(webId)
    : null;
}

export function normalizePodDataResourceId(ref: string): string {
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

export function resolvePodResourceId(resource: AnyPodResource, target: PodResourceTarget): string {
  const knownIri = resolveKnownTargetIri(target);
  if (knownIri) {
    return parsePodResourceRef(resource, knownIri)?.resourceId ?? normalizePodDataResourceId(knownIri);
  }

  if (typeof target === 'string') {
    assertCompleteStringResourceId(resource, target);
    return normalizePodDataResourceId(target);
  }

  const id = typeof target.id === 'string' && target.id.trim().length > 0
    ? target.id.trim()
    : undefined;
  if (!id) {
    throw new Error('resolvePodResourceId requires a resource id on target.id or a full target IRI');
  }
  if (isCompleteResourceId(id)) {
    return normalizePodDataResourceId(id);
  }

  const defaultId = resolveDefaultResourceId(resource, id, target);
  if (defaultId) {
    return normalizePodDataResourceId(defaultId);
  }

  const template = podResourceSubjectTemplate(resource);
  if (template) {
    return normalizePodDataResourceId(renderSubjectTemplateResourceId(template, id, target));
  }

  return normalizePodDataResourceId(id);
}

export function resolvePodResourceTemplateValue(
  resource: AnyPodResource,
  ref: string,
  field = 'id',
): string | null {
  return extractPodResourceTemplateValue(resource, ref, field);
}

export function buildPodResourceIri(webIdOrPodUrl: string, resourceId: string): string {
  const baseUrl = resolvePodBaseUrl(webIdOrPodUrl);
  if (!baseUrl) return resourceId;
  if (/^https?:\/\//u.test(resourceId)) return resourceId;
  const relative = resourceId.startsWith('/')
    ? resourceId
    : `/.data/${normalizePodDataResourceId(resourceId)}`;
  return new URL(relative.replace(/^\/+/u, ''), `${baseUrl}/`).toString();
}

export function buildPodResourceIriForResource(
  webIdOrPodUrl: string,
  resource: AnyPodResource,
  target: PodResourceTarget,
): string {
  const knownIri = resolveKnownTargetIri(target);
  if (knownIri) {
    return knownIri;
  }
  const podRootPath = resolvePodRootTargetPath(target);
  if (podRootPath) {
    return buildPodResourceIri(webIdOrPodUrl, podRootPath);
  }

  const id = resolvePodResourceId(resource, target);
  const relative = isBaseRelativeSubjectId(id)
    ? `${podResourcePath(resource).replace(/\/+$/u, '')}/${normalizeResourcePath(id)}`
    : resource.resolveUri?.(id) ?? `/.data/${normalizePodDataResourceId(id)}`;
  return buildPodResourceIri(webIdOrPodUrl, relative);
}

export function buildPodResourceIriForDatabase(
  database: unknown,
  resource: AnyPodResource,
  target: PodResourceTarget,
): string {
  const podBaseUrl = resolvePodBaseUrlFromDatabase(database);
  if (!podBaseUrl) {
    throw new Error('buildPodResourceIriForDatabase requires a database with a Pod URL or WebID');
  }
  return buildPodResourceIriForResource(podBaseUrl, resource, target);
}

export function resolvePodResourceIriForDatabase(
  database: unknown,
  resource: AnyPodResource,
  target: PodResourceTarget | null | undefined,
): string | null {
  if (!target) return null;
  try {
    return buildPodResourceIriForDatabase(database, resource, target);
  } catch {
    return null;
  }
}

function resolveKnownTargetIri(target: PodResourceTarget): string | null {
  if (typeof target === 'string') {
    return /^https?:\/\//u.test(target) ? target : null;
  }
  const value = target['@id'] ?? target.subject;
  return typeof value === 'string' && /^https?:\/\//u.test(value) ? value : null;
}

function resolvePodRootTargetPath(target: PodResourceTarget): string | null {
  if (typeof target === 'string') {
    return target.startsWith('/') ? target : null;
  }
  const id = typeof target.id === 'string' ? target.id.trim() : '';
  return id.startsWith('/') ? id : null;
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

function assertCompleteStringResourceId(resource: AnyPodResource, id: string): void {
  if (isCompleteResourceId(id)) return;

  const hasDefault = resource.columns?.id?.options?.defaultValue !== undefined;
  const template = podResourceSubjectTemplate(resource);
  if (hasDefault || template) {
    throw new Error(
      'resolvePodResourceId does not accept local keys as string targets. ' +
      'Pass a structured row object with id and required fields, or pass a complete resource id/IRI.'
    );
  }
}

function resolveDefaultResourceId(
  resource: AnyPodResource,
  id: string,
  row: Record<string, unknown>,
): string | null {
  const defaultValue = resource.columns?.id?.options?.defaultValue;
  if (defaultValue === undefined) return null;

  if (typeof defaultValue === 'string') {
    return renderDefaultIdTemplate(defaultValue, { key: id, row, resource });
  }

  if (typeof defaultValue !== 'function') {
    return String(defaultValue);
  }

  const defaultFn = defaultValue as (key?: string, row?: Record<string, unknown>) => unknown;
  if (defaultFn.length === 0) {
    return String(defaultFn());
  }

  return String(defaultFn(id, row));
}

function renderSubjectTemplateResourceId(
  template: string,
  id: string,
  row: Record<string, unknown>,
): string {
  const idTemplate = template.replace(/\{\s*id\s*\}/gu, '{key}');
  return renderDefaultIdTemplate(idTemplate, {
    key: encodeURIComponent(id),
    row,
  });
}

function readPodUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {
    getPodUrl?: () => unknown;
    info?: { podUrl?: unknown };
    podUrl?: unknown;
  };
  const direct = typeof record.getPodUrl === 'function'
    ? record.getPodUrl()
    : record.info?.podUrl ?? record.podUrl;
  return typeof direct === 'string' && direct.trim().length > 0 ? direct : null;
}

function readWebId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {
    info?: { webId?: unknown };
    webId?: unknown;
  };
  const direct = record.info?.webId ?? record.webId;
  return typeof direct === 'string' && direct.trim().length > 0 ? direct : null;
}
