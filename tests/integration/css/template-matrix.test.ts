/**
 * Template Matrix Integration Tests
 * Stable executable matrix distilled from the generated template combinations.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  datetime,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';
import { TEMPLATES, type TemplateConfig } from '../../fixtures/test-matrix';

const timestamp = Date.now();
const containerPath = `/template-matrix-${timestamp}/`;
const baseUrl = `${buildTestPodUrl(containerPath)}`;

vi.setConfig({ testTimeout: 60_000 });

describe('CSS integration: Template Matrix (P0 - Core Functionality)', () => {
  let session: Session;
  let db: SolidDatabase;
  const tables = new Map<string, any>();

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true });
    await ensureContainer(session, containerPath);

    for (const template of TEMPLATES) {
      const templatePath = `${containerPath}${template.name}/`;
      await ensureContainer(session, templatePath);
      tables.set(template.name, createTableForTemplate(template));
    }
  }, 120_000);

  for (const template of TEMPLATES) {
    test(`roundtrip: ${template.name}`, async () => {
      const table = tables.get(template.name);
      const record = createRecordForTemplate(template);

      await db.insert(table).values(record);
      const found = await fetchRecord(template, table, record, db);

      expect(found).not.toBeNull();
      expect(found?.content).toBe(record.content);
    });

    if (template.variables.length > 1) {
      test(`id-only lookup fails: ${template.name}`, async () => {
        const table = tables.get(template.name);
        const record = createRecordForTemplate(template, 'error');

        await db.insert(table).values(record);

        await expect(async () => {
          await db.findByLocator(table, { id: record.id });
        }).rejects.toThrow(/requires a complete locator/);
      });
    }
  }
});

function createTableForTemplate(template: TemplateConfig) {
  const columns: Record<string, any> = {
    id: string('id').primaryKey().predicate('http://schema.org/identifier'),
    content: string('content').notNull().predicate('http://schema.org/text'),
  };

  if (template.variables.includes('chatId')) {
    columns.chatId = string('chatId').notNull().predicate('http://schema.org/chatId');
  }

  if (template.variables.includes('yyyy')) {
    columns.createdAt = datetime('createdAt').notNull().predicate('http://schema.org/dateCreated');
  }

  const base = template.pattern === '#{id}'
    ? `${baseUrl}${template.name}/index.ttl`
    : `${baseUrl}${template.name}/`;

  return podTable(`Matrix_${template.name}`, columns, {
    base,
    type: 'http://schema.org/Message',
    subjectTemplate: template.pattern,
  });
}

function createRecordForTemplate(template: TemplateConfig, suffix = 'ok') {
  const record: Record<string, any> = {
    id: `${template.name}-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
    content: `content:${template.name}:${suffix}`,
  };

  if (template.variables.includes('chatId')) {
    record.chatId = `chat-${template.name}`;
  }

  if (template.variables.includes('yyyy')) {
    record.createdAt = new Date('2026-03-05T10:00:00Z');
  }

  return record;
}

async function fetchRecord(
  template: TemplateConfig,
  table: any,
  record: Record<string, any>,
  db: SolidDatabase,
) {
  if (template.variables.includes('yyyy')) {
    return db.findByIri(table, buildFullUri(template, record));
  }

  if (template.variables.includes('chatId')) {
    return db.findByLocator(table, {
      chatId: record.chatId,
      id: record.id,
    });
  }

  return db.findByLocator(table, { id: record.id });
}

function buildFullUri(template: TemplateConfig, record: Record<string, any>) {
  let pattern = template.pattern;

  if (record.chatId) {
    pattern = pattern.replace('{chatId}', record.chatId);
  }

  if (record.createdAt) {
    const date = new Date(record.createdAt);
    pattern = pattern.replace('{yyyy}', String(date.getUTCFullYear()));
    pattern = pattern.replace('{MM}', String(date.getUTCMonth() + 1).padStart(2, '0'));
    pattern = pattern.replace('{dd}', String(date.getUTCDate()).padStart(2, '0'));
  }

  pattern = pattern.replace('{id}', record.id);
  return `${baseUrl}${template.name}/${pattern}`;
}
