#!/usr/bin/env ts-node
/**
 * Smart Test Generator
 *
 * 基于代码分支分析、Bug 模式分析和 Drizzle ORM 映射，智能生成测试用例
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestTemplate {
  name: string;
  priority: 'P0' | 'P1' | 'P2';
  source: 'code-branch' | 'bug-pattern' | 'drizzle-orm' | 'solid-specific';
  template: string;
  variables: Record<string, string>;
}

/**
 * 从代码分支分析生成测试
 */
function generateFromCodeBranches(): TestTemplate[] {
  const tests: TestTemplate[] = [];

  // Storage Mode
  tests.push({
    name: 'Fragment mode basic CRUD',
    priority: 'P0',
    source: 'code-branch',
    template: `
test('{{name}}', async () => {
  const table = podTable('Test', {
    id: string('id').primaryKey(),
    name: string('name'),
  }, {
    base: '/data/test/',
    type: 'http://schema.org/Thing',
    subjectTemplate: '#{id}',
  });

  await db.init(table);

  // INSERT
  await db.insert(table).values({ id: 'test-1', name: 'Test 1' });

  // SELECT
  const results = await db.select().from(table);
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('Test 1');

  // UPDATE
  await db.update(table).set({ name: 'Updated' }).where(eq(table.columns.id, 'test-1'));

  // DELETE
  await db.delete(table).where(eq(table.columns.id, 'test-1'));
});
`,
    variables: {
      name: 'Fragment mode basic CRUD'
    }
  });

  tests.push({
    name: 'Document mode basic CRUD',
    priority: 'P0',
    source: 'code-branch',
    template: `
test('{{name}}', async () => {
  const table = podTable('Test', {
    id: string('id').primaryKey(),
    name: string('name'),
  }, {
    base: '/data/test/',
    type: 'http://schema.org/Thing',
    subjectTemplate: '{id}.ttl',
  });

  await db.init(table);

  // INSERT
  await db.insert(table).values({ id: 'test-1', name: 'Test 1' });

  // SELECT
  const results = await db.select().from(table);
  expect(results).toHaveLength(1);

  // UPDATE
  await db.update(table).set({ name: 'Updated' }).where(eq(table.columns.id, 'test-1'));

  // DELETE
  await db.delete(table).where(eq(table.columns.id, 'test-1'));
});
`,
    variables: {
      name: 'Document mode basic CRUD'
    }
  });

  // URI Format
  tests.push({
    name: 'Query with full URI',
    priority: 'P0',
    source: 'code-branch',
    template: `
test('{{name}}', async () => {
  const table = podTable('Test', {
    id: string('id').primaryKey(),
    name: string('name'),
  }, {
    base: '/data/test/',
    type: 'http://schema.org/Thing',
    subjectTemplate: '{id}.ttl',
  });

  await db.init(table);
  await db.insert(table).values({ id: 'test-1', name: 'Test 1' });

  // Query with full URI
  const baseUrl = session.info.webId!.split('profile')[0];
  const fullUri = \`\${baseUrl}data/test/test-1.ttl\`;

  const results = await db.select().from(table).where(eq(table.columns.id, fullUri));
  expect(results).toHaveLength(1);
});
`,
    variables: {
      name: 'Query with full URI'
    }
  });

  return tests;
}

/**
 * 从 Bug 模式生成测试
 */
function generateFromBugPatterns(): TestTemplate[] {
  const tests: TestTemplate[] = [];

  // Issue #4: Column Nullability × Query Conditions
  tests.push({
    name: 'SELECT with WHERE on optional column should promote to required',
    priority: 'P0',
    source: 'bug-pattern',
    template: `
test('{{name}}', async () => {
  const table = podTable('Test', {
    id: string('id').primaryKey(),
    optionalField: string('optionalField'), // Optional by default
    requiredField: string('requiredField').notNull(),
  }, {
    base: '/data/test/',
    type: 'http://schema.org/Thing',
    subjectTemplate: '#{id}',
  });

  await db.init(table);
  await db.insert(table).values({
    id: 'test-1',
    optionalField: 'value',
    requiredField: 'required'
  });

  // WHERE on optional column should promote it to required
  const results = await db.select()
    .from(table)
    .where(eq(table.columns.optionalField, 'value'));

  expect(results).toHaveLength(1);
  expect(results[0].optionalField).toBe('value');
});
`,
    variables: {
      name: 'SELECT with WHERE on optional column should promote to required'
    }
  });

  // Issue #3: Template Depth
  tests.push({
    name: 'Document mode with date-partitioned template',
    priority: 'P0',
    source: 'bug-pattern',
    template: `
test('{{name}}', async () => {
  const table = podTable('Message', {
    id: string('id').primaryKey(),
    chatId: string('chatId'),
    content: string('content'),
    createdAt: datetime('createdAt'),
  }, {
    base: '/data/messages/',
    type: 'http://schema.org/Message',
    subjectTemplate: '{chatId}/{yyyy}/{MM}/{dd}/{id}.ttl',
  });

  await db.init(table);

  const message = {
    id: 'msg-1',
    chatId: 'chat-1',
    content: 'Hello',
    createdAt: new Date('2026-03-05T10:00:00Z')
  };

  await db.insert(table).values(message);

  // Query with all variables
  const results = await db.select()
    .from(table)
    .where(and(
      eq(table.columns.id, 'msg-1'),
      eq(table.columns.chatId, 'chat-1')
    ));

  expect(results).toHaveLength(1);
  expect(results[0].content).toBe('Hello');
});
`,
    variables: {
      name: 'Document mode with date-partitioned template'
    }
  });

  // Issue #2: Query Completeness
  tests.push({
    name: 'Query with only ID on multi-variable template should error',
    priority: 'P0',
    source: 'bug-pattern',
    template: `
test('{{name}}', async () => {
  const table = podTable('Test', {
    id: string('id').primaryKey(),
    chatId: string('chatId'),
    name: string('name'),
  }, {
    base: '/data/test/',
    type: 'http://schema.org/Thing',
    subjectTemplate: '{chatId}/{id}.ttl',
  });

  await db.init(table);
  await db.insert(table).values({ id: 'test-1', chatId: 'chat-1', name: 'Test' });

  // Query with only ID should throw error
  await expect(async () => {
    await db.select().from(table).where(eq(table.columns.id, 'test-1'));
  }).rejects.toThrow(/missing required variable/);
});
`,
    variables: {
      name: 'Query with only ID on multi-variable template should error'
    }
  });

  return tests;
}

/**
 * 从 Drizzle ORM 映射生成测试
 */
function generateFromDrizzleORM(): TestTemplate[] {
  const tests: TestTemplate[] = [];

  // Query operators
  const operators = [
    { name: 'eq', op: 'eq', value: "'test'", expected: 'test' },
    { name: 'ne', op: 'ne', value: "'other'", expected: 'test' },
    { name: 'gt', op: 'gt', value: '5', expected: '10' },
    { name: 'gte', op: 'gte', value: '10', expected: '10' },
    { name: 'lt', op: 'lt', value: '15', expected: '10' },
    { name: 'lte', op: 'lte', value: '10', expected: '10' },
  ];

  for (const { name, op, value, expected } of operators) {
    tests.push({
      name: `Query with ${name} operator`,
      priority: 'P1',
      source: 'drizzle-orm',
      template: `
test('Query with ${name} operator', async () => {
  const table = podTable('Test', {
    id: string('id').primaryKey(),
    value: ${value.includes("'") ? 'string' : 'int'}('value'),
  }, {
    base: '/data/test/',
    type: 'http://schema.org/Thing',
    subjectTemplate: '#{id}',
  });

  await db.init(table);
  await db.insert(table).values({ id: 'test-1', value: ${expected} });

  const results = await db.select()
    .from(table)
    .where(${op}(table.columns.value, ${value}));

  expect(results).toHaveLength(1);
});
`,
      variables: { name: `Query with ${name} operator` }
    });
  }

  return tests;
}

/**
 * 生成测试文件
 */
function generateTestFile(tests: TestTemplate[], outputPath: string) {
  let content = `/**
 * Auto-generated tests
 * Generated on: ${new Date().toISOString()}
 *
 * Sources:
 * - Code branch analysis
 * - Bug pattern analysis
 * - Drizzle ORM mapping
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  datetime,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = \`/smart-tests-\${timestamp}/\`;

vi.setConfig({ testTimeout: 60_000 });

describe('Smart Generated Tests', () => {
  let session: Session;
  let db: SolidDatabase;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session, { debug: true }); // Enable debug mode
    await ensureContainer(session, containerPath);
  }, 120_000);

  afterAll(async () => {
    // Cleanup
  });

`;

  // Group by priority
  const byPriority: Record<string, TestTemplate[]> = {};
  for (const test of tests) {
    if (!byPriority[test.priority]) {
      byPriority[test.priority] = [];
    }
    byPriority[test.priority].push(test);
  }

  // Generate tests by priority
  for (const priority of ['P0', 'P1', 'P2']) {
    const priorityTests = byPriority[priority];
    if (!priorityTests || priorityTests.length === 0) continue;

    content += `  describe('${priority} Tests', () => {\n`;

    for (const test of priorityTests) {
      // Replace variables in template
      let testCode = test.template;
      for (const [key, value] of Object.entries(test.variables)) {
        testCode = testCode.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }

      content += testCode + '\n';
    }

    content += `  });\n\n`;
  }

  content += `});\n`;

  fs.writeFileSync(outputPath, content);
  console.log(`Generated test file: ${outputPath}`);
  console.log(`Total tests: ${tests.length}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('Generating smart tests...\n');

  const allTests: TestTemplate[] = [];

  // Generate from different sources
  console.log('1. Generating from code branches...');
  const branchTests = generateFromCodeBranches();
  allTests.push(...branchTests);
  console.log(`   Generated ${branchTests.length} tests`);

  console.log('2. Generating from bug patterns...');
  const bugTests = generateFromBugPatterns();
  allTests.push(...bugTests);
  console.log(`   Generated ${bugTests.length} tests`);

  console.log('3. Generating from Drizzle ORM...');
  const drizzleTests = generateFromDrizzleORM();
  allTests.push(...drizzleTests);
  console.log(`   Generated ${drizzleTests.length} tests`);

  console.log(`\nTotal tests: ${allTests.length}`);

  // Group by priority
  const byPriority = allTests.reduce((acc, test) => {
    acc[test.priority] = (acc[test.priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\nBy priority:');
  for (const [priority, count] of Object.entries(byPriority)) {
    console.log(`  ${priority}: ${count} tests`);
  }

  // Generate test file
  const outputPath = path.join(process.cwd(), 'tests/integration/css/smart-generated.test.ts');
  generateTestFile(allTests, outputPath);

  console.log('\nDone!');
}

if (require.main === module) {
  main().catch(console.error);
}

export { generateFromCodeBranches, generateFromBugPatterns, generateFromDrizzleORM };
