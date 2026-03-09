/**
 * Drizzle ORM to Solid Test Mapper
 *
 * Automatically maps Drizzle ORM SQLite tests to Solid Pod tests
 */

import * as fs from 'fs';
import * as path from 'path';

interface DrizzleTestCase {
  name: string;
  operation: 'select' | 'insert' | 'update' | 'delete';
  operators: string[];
  features: string[];
  code: string;
}

interface SolidTestCase {
  name: string;
  template: string;
  operation: string;
  code: string;
}

/**
 * Extract test cases from Drizzle ORM SQLite tests
 */
function extractDrizzleTests(filePath: string): DrizzleTestCase[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const tests: DrizzleTestCase[] = [];

  // Match test blocks
  const testRegex = /test\(['"]([^'"]+)['"]\s*,\s*async\s*\([^)]*\)\s*=>\s*\{([^}]+(?:\{[^}]*\})*[^}]*)\}/g;
  let match;

  while ((match = testRegex.exec(content)) !== null) {
    const name = match[1];
    const code = match[2];

    // Detect operation
    let operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
    if (code.includes('.insert(')) operation = 'insert';
    else if (code.includes('.update(')) operation = 'update';
    else if (code.includes('.delete(')) operation = 'delete';

    // Detect operators
    const operators: string[] = [];
    if (code.includes('eq(')) operators.push('eq');
    if (code.includes('gt(')) operators.push('gt');
    if (code.includes('gte(')) operators.push('gte');
    if (code.includes('lt(')) operators.push('lt');
    if (code.includes('lte(')) operators.push('lte');
    if (code.includes('and(')) operators.push('and');
    if (code.includes('or(')) operators.push('or');
    if (code.includes('inArray(')) operators.push('inArray');
    if (code.includes('like(')) operators.push('like');

    // Detect features
    const features: string[] = [];
    if (code.includes('.where(')) features.push('where');
    if (code.includes('.orderBy(')) features.push('orderBy');
    if (code.includes('.limit(')) features.push('limit');
    if (code.includes('.offset(')) features.push('offset');
    if (code.includes('.groupBy(')) features.push('groupBy');
    if (code.includes('count(')) features.push('aggregation');
    if (code.includes('.leftJoin(')) features.push('join');

    tests.push({
      name,
      operation,
      operators,
      features,
      code
    });
  }

  return tests;
}

/**
 * Map Drizzle test to Solid test
 */
function mapToSolidTest(drizzleTest: DrizzleTestCase, template: string): SolidTestCase {
  let solidCode = drizzleTest.code;

  // Replace table definitions
  solidCode = solidCode.replace(/sqliteTable\(/g, 'podTable(');
  solidCode = solidCode.replace(/integer\(/g, 'int(');
  solidCode = solidCode.replace(/text\(/g, 'string(');
  solidCode = solidCode.replace(/blob\(/g, 'json(');

  // Add Solid-specific config
  const tableConfigRegex = /podTable\(['"](\w+)['"]\s*,\s*\{([^}]+)\}/g;
  solidCode = solidCode.replace(tableConfigRegex, (match, tableName, columns) => {
    return `podTable('${tableName}', {${columns}}, {
  base: '/data/${tableName}/',
  type: 'http://schema.org/${tableName}',
  subjectTemplate: '${template}',
  typeIndex: undefined
})`;
  });

  // Replace database operations
  solidCode = solidCode.replace(/db\.run\(sql`drop table/g, '// db.run(sql`drop table');
  solidCode = solidCode.replace(/db\.run\(sql`create table/g, '// db.run(sql`create table');

  return {
    name: `Solid: ${drizzleTest.name}`,
    template,
    operation: drizzleTest.operation,
    code: solidCode
  };
}

/**
 * Generate Solid test file from Drizzle tests
 */
function generateSolidTestFile(drizzleTests: DrizzleTestCase[], outputPath: string) {
  const templates = [
    '#{id}',
    '{id}.ttl',
    '{chatId}/{id}.ttl',
    '{chatId}/{yyyy}/{MM}/{dd}/{id}.ttl'
  ];

  let output = `/**
 * Auto-generated Solid tests from Drizzle ORM SQLite tests
 *
 * Generated on: ${new Date().toISOString()}
 */

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import {
  podTable,
  string,
  int,
  datetime,
  eq,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  inArray,
  like
} from '../../../src/index';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { createTestSession, ensureContainer } from './helpers';

const timestamp = Date.now();
const containerPath = \`/drizzle-mapped-\${timestamp}/\`;

vi.setConfig({ testTimeout: 60_000 });

describe('Drizzle ORM Mapped Tests', () => {
  let session: Session;
  let db: SolidDatabase;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    await ensureContainer(session, containerPath);
  }, 120_000);

  afterAll(async () => {
    // Cleanup
  });

`;

  // Select high-value tests to map
  const selectedTests = drizzleTests.filter(test => {
    // Include tests with common operators
    const hasCommonOperators = test.operators.some(op =>
      ['eq', 'gt', 'and', 'or', 'inArray'].includes(op)
    );

    // Include tests with important features
    const hasImportantFeatures = test.features.some(f =>
      ['where', 'orderBy', 'limit'].includes(f)
    );

    // Exclude complex tests
    const isSimple = !test.features.includes('join') &&
                     !test.features.includes('groupBy') &&
                     !test.name.includes('transaction');

    return (hasCommonOperators || hasImportantFeatures) && isSimple;
  }).slice(0, 50); // Limit to 50 tests

  // Generate tests for each template
  for (const template of templates) {
    output += `  describe('Template: ${template}', () => {\n`;

    for (const drizzleTest of selectedTests) {
      const solidTest = mapToSolidTest(drizzleTest, template);

      output += `    test('${solidTest.name}', async () => {
      // TODO: Implement test
      // Original Drizzle code:
      ${solidTest.code.split('\n').map(line => `      // ${line}`).join('\n')}
    });\n\n`;
    }

    output += `  });\n\n`;
  }

  output += `});\n`;

  fs.writeFileSync(outputPath, output);
  console.log(`Generated Solid test file: ${outputPath}`);
  console.log(`Total tests: ${selectedTests.length * templates.length}`);
}

/**
 * Main execution
 */
async function main() {
  const drizzleTestPath = '/tmp/drizzle-orm/integration-tests/tests/sqlite/sqlite-common.ts';
  const outputPath = path.join(process.cwd(), 'tests/integration/css/drizzle-mapped.test.ts');

  console.log('Extracting Drizzle ORM tests...');
  const drizzleTests = extractDrizzleTests(drizzleTestPath);
  console.log(`Found ${drizzleTests.length} Drizzle tests`);

  console.log('\nTest breakdown:');
  const byOperation = drizzleTests.reduce((acc, test) => {
    acc[test.operation] = (acc[test.operation] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('By operation:', byOperation);

  const operatorCounts = drizzleTests.reduce((acc, test) => {
    test.operators.forEach(op => {
      acc[op] = (acc[op] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);
  console.log('Operator usage:', operatorCounts);

  console.log('\nGenerating Solid test file...');
  generateSolidTestFile(drizzleTests, outputPath);

  console.log('\nDone!');
}

if (require.main === module) {
  main().catch(console.error);
}

export { extractDrizzleTests, mapToSolidTest, generateSolidTestFile };
