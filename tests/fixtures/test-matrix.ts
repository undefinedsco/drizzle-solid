/**
 * Test Matrix Generator
 *
 * Generates comprehensive test cases by combining:
 * - Storage modes (fragment/document)
 * - Template patterns (single/multi-variable)
 * - Query patterns (by id, by other fields, combined)
 * - Operations (INSERT, SELECT, UPDATE, DELETE)
 */

export interface TemplateConfig {
  name: string;
  mode: 'fragment' | 'document';
  pattern: string;
  variables: string[];
  description: string;
}

export interface QueryPattern {
  name: string;
  description: string;
  buildWhere: (table: any, values: Record<string, any>) => any;
  requiredFields: string[];
  shouldSucceed: boolean;
}

export interface TestCase {
  operation: 'INSERT' | 'SELECT' | 'UPDATE' | 'DELETE';
  template: TemplateConfig;
  query: QueryPattern;
  expectedResult: 'success' | 'error';
  errorPattern?: RegExp;
}

// Template configurations
export const TEMPLATES: TemplateConfig[] = [
  // Fragment mode - single variable
  {
    name: 'fragment-single',
    mode: 'fragment',
    pattern: '#{id}',
    variables: ['id'],
    description: 'Fragment mode with single variable (all records in one file)'
  },

  // Fragment mode - multi-variable
  {
    name: 'fragment-multi',
    mode: 'fragment',
    pattern: '{chatId}/index.ttl#{id}',
    variables: ['chatId', 'id'],
    description: 'Fragment mode with chatId partition'
  },

  // Fragment mode - date-partitioned
  {
    name: 'fragment-date',
    mode: 'fragment',
    pattern: '{chatId}/{yyyy}/{MM}/{dd}/messages.ttl#{id}',
    variables: ['chatId', 'yyyy', 'MM', 'dd', 'id'],
    description: 'Fragment mode with date partitioning'
  },

  // Document mode - single variable
  {
    name: 'document-single',
    mode: 'document',
    pattern: '{id}.ttl',
    variables: ['id'],
    description: 'Document mode with single variable (one file per record)'
  },

  // Document mode - multi-variable
  {
    name: 'document-multi',
    mode: 'document',
    pattern: '{chatId}/{id}.ttl',
    variables: ['chatId', 'id'],
    description: 'Document mode with chatId partition'
  },

  // Document mode - date-partitioned
  {
    name: 'document-date',
    mode: 'document',
    pattern: '{chatId}/{yyyy}/{MM}/{dd}/{id}.ttl',
    variables: ['chatId', 'yyyy', 'MM', 'dd', 'id'],
    description: 'Document mode with date partitioning'
  },
];

// Query patterns
export const QUERY_PATTERNS: QueryPattern[] = [
  // Query by ID only
  {
    name: 'by-id-only',
    description: 'Query with only ID (short id)',
    buildWhere: (table, values) => ({ id: values.id }),
    requiredFields: ['id'],
    shouldSucceed: false, // Should fail for multi-variable templates
  },

  // Query by ID with full URI
  {
    name: 'by-full-uri',
    description: 'Query with full URI',
    buildWhere: (table, values) => ({ id: values.fullUri }),
    requiredFields: ['fullUri'],
    shouldSucceed: true, // Should always work
  },

  // Query with all variables
  {
    name: 'by-all-variables',
    description: 'Query with all template variables',
    buildWhere: (table, values) => {
      const where: any = {};
      for (const key of Object.keys(values)) {
        where[key] = values[key];
      }
      return where;
    },
    requiredFields: ['id', 'chatId'], // Will be adjusted per template
    shouldSucceed: true,
  },

  // Query by non-ID field
  {
    name: 'by-other-field',
    description: 'Query by chatId only',
    buildWhere: (table, values) => ({ chatId: values.chatId }),
    requiredFields: ['chatId'],
    shouldSucceed: true, // Should scan the partition
  },
];

/**
 * Generate test matrix
 */
export function generateTestMatrix(): TestCase[] {
  const testCases: TestCase[] = [];

  for (const template of TEMPLATES) {
    for (const query of QUERY_PATTERNS) {
      // Determine if this combination should succeed
      const hasMultipleVars = template.variables.length > 1;
      const providesAllVars = query.name === 'by-all-variables' || query.name === 'by-full-uri';
      const isIdOnly = query.name === 'by-id-only';

      let expectedResult: 'success' | 'error';
      let errorPattern: RegExp | undefined;

      if (hasMultipleVars && isIdOnly) {
        // Multi-variable template + ID only = should error
        expectedResult = 'error';
        errorPattern = /missing required variable/;
      } else if (providesAllVars || !hasMultipleVars) {
        // All variables provided OR single-variable template = should succeed
        expectedResult = 'success';
      } else {
        // Other cases depend on specific logic
        expectedResult = query.shouldSucceed ? 'success' : 'error';
      }

      // Generate test cases for each operation
      for (const operation of ['INSERT', 'SELECT', 'UPDATE', 'DELETE'] as const) {
        testCases.push({
          operation,
          template,
          query,
          expectedResult,
          errorPattern,
        });
      }
    }
  }

  return testCases;
}

/**
 * Filter test cases by priority
 */
export function filterByPriority(testCases: TestCase[], priority: 'P0' | 'P1' | 'P2'): TestCase[] {
  if (priority === 'P0') {
    // P0: Core functionality that must work
    return testCases.filter(tc =>
      tc.expectedResult === 'success' &&
      (tc.query.name === 'by-all-variables' || tc.query.name === 'by-full-uri')
    );
  } else if (priority === 'P1') {
    // P1: Error cases and edge cases
    return testCases.filter(tc =>
      tc.expectedResult === 'error' ||
      tc.query.name === 'by-id-only'
    );
  } else {
    // P2: Advanced scenarios
    return testCases.filter(tc =>
      tc.template.variables.length > 2 // 3+ variables
    );
  }
}

/**
 * Get test statistics
 */
export function getTestStats(testCases: TestCase[]) {
  const total = testCases.length;
  const byOperation = {
    INSERT: testCases.filter(tc => tc.operation === 'INSERT').length,
    SELECT: testCases.filter(tc => tc.operation === 'SELECT').length,
    UPDATE: testCases.filter(tc => tc.operation === 'UPDATE').length,
    DELETE: testCases.filter(tc => tc.operation === 'DELETE').length,
  };
  const byResult = {
    success: testCases.filter(tc => tc.expectedResult === 'success').length,
    error: testCases.filter(tc => tc.expectedResult === 'error').length,
  };
  const byMode = {
    fragment: testCases.filter(tc => tc.template.mode === 'fragment').length,
    document: testCases.filter(tc => tc.template.mode === 'document').length,
  };

  return {
    total,
    byOperation,
    byResult,
    byMode,
  };
}

// Generate and export test matrix
export const TEST_MATRIX = generateTestMatrix();
export const P0_TESTS = filterByPriority(TEST_MATRIX, 'P0');
export const P1_TESTS = filterByPriority(TEST_MATRIX, 'P1');
export const P2_TESTS = filterByPriority(TEST_MATRIX, 'P2');

// Print statistics
if (require.main === module) {
  console.log('Test Matrix Statistics:');
  console.log('======================');
  console.log('Total test cases:', TEST_MATRIX.length);
  console.log('\nBy Priority:');
  console.log('  P0 (Core):', P0_TESTS.length);
  console.log('  P1 (Edge):', P1_TESTS.length);
  console.log('  P2 (Advanced):', P2_TESTS.length);
  console.log('\nFull Matrix:');
  console.log(getTestStats(TEST_MATRIX));
}
