import type { PodTable } from './schema';

type ExactRecordTarget = string | Record<string, unknown> | null | undefined;
type ExactRecordResolvedTarget = string | Record<string, unknown>;
type ExactPodTable = PodTable<any>;

export type ExactRecordDatabase = {
  findByResource?: <TResource extends ExactPodTable>(resource: TResource, target: ExactRecordResolvedTarget) => Promise<unknown | null>;
  updateByResource?: <TResource extends ExactPodTable>(
    resource: TResource,
    target: ExactRecordResolvedTarget,
    data: any,
  ) => Promise<unknown | null>;
  deleteByResource?: <TResource extends ExactPodTable>(resource: TResource, target: ExactRecordResolvedTarget) => Promise<unknown>;
  insert?: <TResource extends ExactPodTable>(resource: TResource) => {
    values(value: any): {
      execute(): Promise<unknown>;
    };
  };
};

const IDENTITY_FIELDS = new Set(['id', '@id', 'subject', 'uri']);

export async function findExactRecord<T>(
  db: ExactRecordDatabase,
  resource: ExactPodTable,
  target: ExactRecordTarget,
): Promise<T | null> {
  const resourceTarget = requireResourceTarget(target, 'find');
  if (typeof db.findByResource !== 'function') {
    throw new Error('Solid database does not support findByResource.');
  }
  return db.findByResource(resource, resourceTarget) as Promise<T | null>;
}

export async function updateExactRecord(
  db: ExactRecordDatabase,
  resource: ExactPodTable,
  target: ExactRecordTarget,
  updates: Record<string, unknown>,
): Promise<void> {
  const resourceTarget = requireResourceTarget(target, 'update');
  const payload = sanitizeUpdatePayload(updates);
  if (typeof db.updateByResource !== 'function') {
    throw new Error('Solid database does not support updateByResource.');
  }
  await db.updateByResource(resource, resourceTarget, payload);
}

export async function upsertExactRecord(
  db: ExactRecordDatabase,
  resource: ExactPodTable,
  target: ExactRecordTarget,
  row: Record<string, unknown>,
  updates: Record<string, unknown>,
): Promise<'inserted' | 'updated'> {
  const resourceTarget = requireResourceTarget(target, 'upsert');
  if (typeof db.findByResource !== 'function') {
    throw new Error('Solid database does not support findByResource.');
  }
  if (typeof db.updateByResource !== 'function') {
    throw new Error('Solid database does not support updateByResource.');
  }
  const existing = await db.findByResource(resource, resourceTarget);
  if (!existing) {
    await insertExactRecord(db, resource, row);
    return 'inserted';
  }
  await db.updateByResource(resource, resourceTarget, sanitizeUpdatePayload(updates));
  return 'updated';
}

export async function insertExactRecordOnce(
  db: ExactRecordDatabase,
  resource: ExactPodTable,
  target: ExactRecordTarget,
  row: Record<string, unknown>,
): Promise<boolean> {
  const resourceTarget = requireResourceTarget(target, 'insert');
  if (typeof db.findByResource !== 'function') {
    throw new Error('Solid database does not support findByResource.');
  }
  const existing = await db.findByResource(resource, resourceTarget);
  if (existing) {
    return false;
  }
  await insertExactRecord(db, resource, row);
  return true;
}

export async function deleteExactRecord(
  db: ExactRecordDatabase,
  resource: ExactPodTable,
  target: ExactRecordTarget,
): Promise<void> {
  const resourceTarget = requireResourceTarget(target, 'delete');
  if (typeof db.deleteByResource !== 'function') {
    throw new Error('Solid database does not support deleteByResource.');
  }
  await db.deleteByResource(resource, resourceTarget);
}

async function insertExactRecord(
  db: ExactRecordDatabase,
  resource: ExactPodTable,
  row: Record<string, unknown>,
): Promise<void> {
  if (typeof db.insert !== 'function') {
    throw new Error('Solid database does not support insert.');
  }
  await db.insert(resource).values(row).execute();
}

function requireResourceTarget(target: ExactRecordTarget, action: string): ExactRecordResolvedTarget {
  if (typeof target === 'string') {
    if (target.length > 0) return target;
    throw new Error(`Cannot ${action} exact record with an empty target.`);
  }

  if (target && typeof target === 'object') {
    return target;
  }

  throw new Error(`Cannot ${action} exact record without a resource target.`);
}

function sanitizeUpdatePayload(updates: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!IDENTITY_FIELDS.has(key) && value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}
