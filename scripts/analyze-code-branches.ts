#!/usr/bin/env ts-node
/**
 * Code Branch Analyzer
 *
 * 从源代码中提取所有条件分支，识别测试维度
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface Branch {
  file: string;
  line: number;
  condition: string;
  type: 'if' | 'else' | 'switch' | 'case' | 'ternary';
  context: string;
}

interface Dimension {
  name: string;
  description: string;
  values: string[];
  source: string; // 从哪个文件/分支提取的
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

/**
 * 提取文件中的所有条件分支
 */
function extractBranches(filePath: string): Branch[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const branches: Branch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // if 语句
    if (trimmed.startsWith('if (') || trimmed.includes(' if (')) {
      const match = line.match(/if\s*\(([^)]+)\)/);
      if (match) {
        branches.push({
          file: filePath,
          line: i + 1,
          condition: match[1],
          type: 'if',
          context: lines.slice(Math.max(0, i - 2), i + 3).join('\n')
        });
      }
    }

    // switch 语句
    if (trimmed.startsWith('switch (')) {
      const match = line.match(/switch\s*\(([^)]+)\)/);
      if (match) {
        branches.push({
          file: filePath,
          line: i + 1,
          condition: match[1],
          type: 'switch',
          context: lines.slice(Math.max(0, i - 2), i + 10).join('\n')
        });
      }
    }

    // 三元运算符
    if (line.includes('?') && line.includes(':')) {
      const match = line.match(/([^?]+)\?/);
      if (match && !line.includes('//')) {
        branches.push({
          file: filePath,
          line: i + 1,
          condition: match[1].trim(),
          type: 'ternary',
          context: line
        });
      }
    }
  }

  return branches;
}

/**
 * 从条件分支中识别测试维度
 */
function identifyDimensions(branches: Branch[]): Dimension[] {
  const dimensions: Dimension[] = [];
  const seen = new Set<string>();

  for (const branch of branches) {
    const condition = branch.condition.toLowerCase();

    // Storage mode
    if (condition.includes('mode') && (condition.includes('fragment') || condition.includes('document'))) {
      if (!seen.has('storageMode')) {
        dimensions.push({
          name: 'Storage Mode',
          description: 'Fragment vs Document mode',
          values: ['fragment', 'document'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P0'
        });
        seen.add('storageMode');
      }
    }

    // Template variables
    if (condition.includes('template') || condition.includes('variables') || condition.includes('requiredvars')) {
      if (!seen.has('templateVariables')) {
        dimensions.push({
          name: 'Template Variables',
          description: 'Number and type of template variables',
          values: ['single', 'multi', 'date-partitioned'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P0'
        });
        seen.add('templateVariables');
      }
    }

    // URI format
    if (condition.includes('uri') || condition.includes('http') || condition.includes('://')) {
      if (!seen.has('uriFormat')) {
        dimensions.push({
          name: 'URI Format',
          description: 'Full URI vs short ID',
          values: ['full-uri', 'short-id', 'relative-path'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P0'
        });
        seen.add('uriFormat');
      }
    }

    // Nullability
    if (condition.includes('null') || condition.includes('undefined') || condition.includes('optional')) {
      if (!seen.has('nullability')) {
        dimensions.push({
          name: 'Column Nullability',
          description: 'Required vs optional columns',
          values: ['required', 'optional', 'nullable'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P0'
        });
        seen.add('nullability');
      }
    }

    // SPARQL endpoint
    if (condition.includes('sparql') || condition.includes('endpoint')) {
      if (!seen.has('sparqlEngine')) {
        dimensions.push({
          name: 'SPARQL Engine',
          description: 'LDP only vs SPARQL endpoint',
          values: ['ldp-only', 'sparql-endpoint', 'hybrid'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P0'
        });
        seen.add('sparqlEngine');
      }
    }

    // Container vs resource
    if (condition.includes('container') || condition.includes('resource')) {
      if (!seen.has('resourceType')) {
        dimensions.push({
          name: 'Resource Type',
          description: 'Container vs individual resource',
          values: ['container', 'resource', 'nested-container'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P1'
        });
        seen.add('resourceType');
      }
    }

    // Array/batch operations
    if (condition.includes('array') || condition.includes('batch') || condition.includes('length')) {
      if (!seen.has('operationSize')) {
        dimensions.push({
          name: 'Operation Size',
          description: 'Single vs batch operations',
          values: ['single', 'batch-small', 'batch-large'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P1'
        });
        seen.add('operationSize');
      }
    }

    // Error handling
    if (condition.includes('error') || condition.includes('throw') || condition.includes('catch')) {
      if (!seen.has('errorHandling')) {
        dimensions.push({
          name: 'Error Scenarios',
          description: 'Various error conditions',
          values: ['success', 'validation-error', 'network-error', 'conflict'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P2'
        });
        seen.add('errorHandling');
      }
    }

    // Cache
    if (condition.includes('cache') || condition.includes('cached')) {
      if (!seen.has('caching')) {
        dimensions.push({
          name: 'Caching',
          description: 'Cache hit vs miss',
          values: ['no-cache', 'cache-hit', 'cache-miss', 'cache-expired'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P2'
        });
        seen.add('caching');
      }
    }

    // Authentication
    if (condition.includes('auth') || condition.includes('token') || condition.includes('session')) {
      if (!seen.has('authentication')) {
        dimensions.push({
          name: 'Authentication',
          description: 'Auth state and token validity',
          values: ['authenticated', 'unauthenticated', 'token-expired', 'invalid-token'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P1'
        });
        seen.add('authentication');
      }
    }

    // Type checking
    if (condition.includes('typeof') || condition.includes('instanceof')) {
      if (!seen.has('dataTypes')) {
        dimensions.push({
          name: 'Data Types',
          description: 'Runtime type variations',
          values: ['string', 'number', 'boolean', 'object', 'array', 'null', 'undefined'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P1'
        });
        seen.add('dataTypes');
      }
    }

    // Empty/length checks
    if (condition.includes('length') || condition.includes('empty') || condition.includes('size')) {
      if (!seen.has('dataSize')) {
        dimensions.push({
          name: 'Data Size',
          description: 'Empty vs populated data',
          values: ['empty', 'single', 'small', 'medium', 'large'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P2'
        });
        seen.add('dataSize');
      }
    }

    // Status codes
    if (condition.includes('status') || condition.includes('code') || /\d{3}/.test(condition)) {
      if (!seen.has('httpStatus')) {
        dimensions.push({
          name: 'HTTP Status',
          description: 'Various HTTP response codes',
          values: ['200', '201', '204', '400', '401', '403', '404', '409', '500'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P2'
        });
        seen.add('httpStatus');
      }
    }

    // Predicate/namespace
    if (condition.includes('predicate') || condition.includes('namespace')) {
      if (!seen.has('rdfMapping')) {
        dimensions.push({
          name: 'RDF Mapping',
          description: 'Custom vs default predicates',
          values: ['default-predicate', 'custom-predicate', 'inverse-predicate'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P1'
        });
        seen.add('rdfMapping');
      }
    }

    // Reference/foreign key
    if (condition.includes('reference') || condition.includes('foreign')) {
      if (!seen.has('relationships')) {
        dimensions.push({
          name: 'Data Relationships',
          description: 'Foreign key relationships',
          values: ['no-relation', 'one-to-one', 'one-to-many', 'many-to-many'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P1'
        });
        seen.add('relationships');
      }
    }

    // Transaction/conflict
    if (condition.includes('transaction') || condition.includes('conflict') || condition.includes('etag')) {
      if (!seen.has('concurrency')) {
        dimensions.push({
          name: 'Concurrency Control',
          description: 'Concurrent access patterns',
          values: ['single-writer', 'concurrent-reads', 'concurrent-writes', 'conflict-resolution'],
          source: `${branch.file}:${branch.line}`,
          priority: 'P2'
        });
        seen.add('concurrency');
      }
    }
  }

  return dimensions;
}

/**
 * 分析关键文件
 */
async function analyzeCodebase(): Promise<{
  branches: Branch[];
  dimensions: Dimension[];
  coverage: Map<string, number>;
}> {
  const coreFiles = [
    'src/core/resource-resolver/**/*.ts',
    'src/core/sparql/builder/**/*.ts',
    'src/core/execution/**/*.ts',
    'src/core/uri/**/*.ts',
  ];

  const allBranches: Branch[] = [];
  const coverage = new Map<string, number>();

  for (const pattern of coreFiles) {
    const files = await glob(pattern, { cwd: process.cwd() });

    for (const file of files) {
      const branches = extractBranches(file);
      allBranches.push(...branches);
      coverage.set(file, branches.length);
    }
  }

  const dimensions = identifyDimensions(allBranches);

  return { branches: allBranches, dimensions, coverage };
}

/**
 * 生成报告
 */
function generateReport(result: {
  branches: Branch[];
  dimensions: Dimension[];
  coverage: Map<string, number>;
}) {
  console.log('\n' + '='.repeat(80));
  console.log('CODE BRANCH ANALYSIS REPORT');
  console.log('='.repeat(80) + '\n');

  console.log(`Total conditional branches: ${result.branches.length}`);
  console.log(`Identified dimensions: ${result.dimensions.length}\n`);

  // Group by priority
  const byPriority: Record<string, Dimension[]> = {};
  for (const dim of result.dimensions) {
    if (!byPriority[dim.priority]) {
      byPriority[dim.priority] = [];
    }
    byPriority[dim.priority].push(dim);
  }

  // Print dimensions by priority
  for (const priority of ['P0', 'P1', 'P2', 'P3']) {
    const dims = byPriority[priority];
    if (!dims || dims.length === 0) continue;

    console.log(`\n${priority} Dimensions (${dims.length}):`);
    console.log('-'.repeat(80));

    for (const dim of dims) {
      console.log(`\n${dim.name}`);
      console.log(`  Description: ${dim.description}`);
      console.log(`  Values: ${dim.values.join(', ')}`);
      console.log(`  Source: ${dim.source}`);
    }
  }

  // Print top files by branch count
  console.log('\n' + '='.repeat(80));
  console.log('TOP FILES BY BRANCH COUNT');
  console.log('='.repeat(80) + '\n');

  const sorted = Array.from(result.coverage.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [file, count] of sorted) {
    console.log(`${count.toString().padStart(4)} branches - ${file}`);
  }

  // Calculate test requirements
  console.log('\n' + '='.repeat(80));
  console.log('ESTIMATED TEST REQUIREMENTS');
  console.log('='.repeat(80) + '\n');

  const p0Dims = byPriority['P0'] || [];
  const p1Dims = byPriority['P1'] || [];
  const p2Dims = byPriority['P2'] || [];

  const p0Tests = p0Dims.reduce((sum, dim) => sum + dim.values.length, 0);
  const p1Tests = p1Dims.reduce((sum, dim) => sum + dim.values.length, 0);
  const p2Tests = p2Dims.reduce((sum, dim) => sum + dim.values.length, 0);

  console.log(`P0 (Core): ${p0Tests} tests (${p0Dims.length} dimensions)`);
  console.log(`P1 (Common): ${p1Tests} tests (${p1Dims.length} dimensions)`);
  console.log(`P2 (Advanced): ${p2Tests} tests (${p2Dims.length} dimensions)`);
  console.log(`\nTotal: ${p0Tests + p1Tests + p2Tests} tests (minimum)`);

  // Save to file
  const reportPath = path.join(process.cwd(), 'branch-analysis-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('Analyzing codebase for conditional branches...\n');
  const result = await analyzeCodebase();
  generateReport(result);
}

if (require.main === module) {
  main().catch(console.error);
}

export { extractBranches, identifyDimensions, analyzeCodebase };
