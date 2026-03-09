#!/usr/bin/env ts-node
/**
 * Bug Pattern Analyzer
 *
 * 从历史 issues 中提取测试维度和边界情况
 */

import * as fs from 'fs';

interface Issue {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  body: string;
  rootCause?: string;
  missingDimensions?: string[];
  edgeCases?: string[];
}

interface TestGap {
  dimension: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  testCases: string[];
  source: string; // 来自哪个 issue
}

/**
 * 分析 issue 并提取测试缺口
 */
function analyzeIssue(issue: Issue): TestGap[] {
  const gaps: TestGap[] = [];

  // Issue #4: FILTER on OPTIONAL variable
  if (issue.number === 4) {
    gaps.push({
      dimension: 'Column Nullability × Query Conditions',
      description: 'WHERE 引用的列应该从 OPTIONAL 提升为 required',
      priority: 'P0',
      testCases: [
        'SELECT with WHERE on optional column',
        'SELECT with WHERE on required column',
        'SELECT with WHERE on .notNull() column',
        'SELECT with WHERE on uri().reference() column',
      ],
      source: 'Issue #4'
    });
  }

  // Issue #3: Deep subdirectories
  if (issue.number === 3) {
    gaps.push({
      dimension: 'Template Depth × SPARQL Engine',
      description: 'Date-partitioned document mode 的查询',
      priority: 'P0',
      testCases: [
        'Document mode with 1-level template: {id}.ttl',
        'Document mode with 2-level template: {chatId}/{id}.ttl',
        'Document mode with 3-level template: {workspace}/{chatId}/{id}.ttl',
        'Document mode with date template: {chatId}/{yyyy}/{MM}/{dd}/{id}.ttl',
      ],
      source: 'Issue #3'
    });
  }

  // Issue #2: Multi-variable template with partial values
  if (issue.number === 2) {
    gaps.push({
      dimension: 'Query Completeness × Template Variables',
      description: '查询时提供的变量数量',
      priority: 'P0',
      testCases: [
        'Query with all template variables',
        'Query with only ID (short)',
        'Query with only ID (full URI)',
        'Query with partial variables (missing ID)',
        'Query with partial variables (missing other vars)',
      ],
      source: 'Issue #2'
    });
  }

  // Issue #1: findFirst with multi-variable template
  if (issue.number === 1) {
    gaps.push({
      dimension: 'API Interface × Template Variables',
      description: 'findFirst 在 multi-variable template 上的行为',
      priority: 'P1',
      testCases: [
        'findFirst with single-variable template',
        'findFirst with multi-variable template + all vars',
        'findFirst with multi-variable template + partial vars',
        'db.query.table.findFirst vs db.select().from()',
      ],
      source: 'Issue #1'
    });
  }

  return gaps;
}

/**
 * 从 bug 模式中推断边界情况
 */
function inferEdgeCases(gaps: TestGap[]): string[] {
  const edgeCases: string[] = [];

  // 从已知 bug 推断类似场景
  for (const gap of gaps) {
    if (gap.dimension.includes('Nullability')) {
      edgeCases.push('Column with .default() in WHERE clause');
      edgeCases.push('Column with .unique() in WHERE clause');
      edgeCases.push('Multiple optional columns in WHERE with AND');
      edgeCases.push('Multiple optional columns in WHERE with OR');
    }

    if (gap.dimension.includes('Template')) {
      edgeCases.push('Template with special characters in variable names');
      edgeCases.push('Template with numeric variables');
      edgeCases.push('Template with very long paths (>10 levels)');
      edgeCases.push('Template with duplicate variable names');
    }

    if (gap.dimension.includes('Query Completeness')) {
      edgeCases.push('Query with extra variables not in template');
      edgeCases.push('Query with null/undefined values');
      edgeCases.push('Query with empty string values');
      edgeCases.push('Query with special characters in values');
    }

    if (gap.dimension.includes('API Interface')) {
      edgeCases.push('Mixed API usage in same query');
      edgeCases.push('Chained query builder methods');
      edgeCases.push('Query builder with raw SQL fragments');
    }
  }

  return [...new Set(edgeCases)];
}

/**
 * 生成测试优先级矩阵
 */
function generatePriorityMatrix(gaps: TestGap[]): {
  p0: number;
  p1: number;
  p2: number;
  total: number;
} {
  const p0 = gaps.filter(g => g.priority === 'P0').reduce((sum, g) => sum + g.testCases.length, 0);
  const p1 = gaps.filter(g => g.priority === 'P1').reduce((sum, g) => sum + g.testCases.length, 0);
  const p2 = gaps.filter(g => g.priority === 'P2').reduce((sum, g) => sum + g.testCases.length, 0);

  return { p0, p1, p2, total: p0 + p1 + p2 };
}

/**
 * Main execution
 */
function main() {
  console.log('\n' + '='.repeat(80));
  console.log('BUG PATTERN ANALYSIS');
  console.log('='.repeat(80) + '\n');

  // 分析已知 issues
  const issues: Issue[] = [
    { number: 5, title: 'FILTER on OPTIONAL variable produces empty results', state: 'CLOSED', body: '' },
    { number: 4, title: 'Bug: FILTER placed outside OPTIONAL blocks', state: 'CLOSED', body: '' },
    { number: 3, title: 'SPARQL Endpoint Cannot Query Data in Deep Subdirectories', state: 'OPEN', body: '' },
    { number: 2, title: 'Bug: subjectTemplate with non-id fields fails silently', state: 'OPEN', body: '' },
    { number: 1, title: 'findFirst generates incorrect FILTER URI', state: 'CLOSED', body: '' },
  ];

  const allGaps: TestGap[] = [];
  for (const issue of issues) {
    const gaps = analyzeIssue(issue);
    allGaps.push(...gaps);
  }

  console.log(`Analyzed ${issues.length} issues`);
  console.log(`Identified ${allGaps.length} test gaps\n`);

  // 按优先级分组
  const byPriority: Record<string, TestGap[]> = {};
  for (const gap of allGaps) {
    if (!byPriority[gap.priority]) {
      byPriority[gap.priority] = [];
    }
    byPriority[gap.priority].push(gap);
  }

  // 打印测试缺口
  for (const priority of ['P0', 'P1', 'P2']) {
    const gaps = byPriority[priority];
    if (!gaps || gaps.length === 0) continue;

    console.log(`\n${priority} Test Gaps (${gaps.length}):`);
    console.log('-'.repeat(80));

    for (const gap of gaps) {
      console.log(`\n${gap.dimension}`);
      console.log(`  Description: ${gap.description}`);
      console.log(`  Source: ${gap.source}`);
      console.log(`  Test cases (${gap.testCases.length}):`);
      for (const testCase of gap.testCases) {
        console.log(`    - ${testCase}`);
      }
    }
  }

  // 推断边界情况
  console.log('\n' + '='.repeat(80));
  console.log('INFERRED EDGE CASES');
  console.log('='.repeat(80) + '\n');

  const edgeCases = inferEdgeCases(allGaps);
  console.log(`Inferred ${edgeCases.length} edge cases from bug patterns:\n`);

  for (const edgeCase of edgeCases) {
    console.log(`  - ${edgeCase}`);
  }

  // 计算测试需求
  console.log('\n' + '='.repeat(80));
  console.log('TEST REQUIREMENTS FROM BUGS');
  console.log('='.repeat(80) + '\n');

  const matrix = generatePriorityMatrix(allGaps);
  console.log(`P0 (Critical): ${matrix.p0} tests`);
  console.log(`P1 (Important): ${matrix.p1} tests`);
  console.log(`P2 (Nice to have): ${matrix.p2} tests`);
  console.log(`\nTotal from bugs: ${matrix.total} tests`);
  console.log(`Edge cases: ${edgeCases.length} tests`);
  console.log(`\nGrand total: ${matrix.total + edgeCases.length} tests`);

  // 保存报告
  const report = {
    issues: issues.length,
    gaps: allGaps,
    edgeCases,
    matrix,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync('bug-pattern-report.json', JSON.stringify(report, null, 2));
  console.log('\nReport saved to: bug-pattern-report.json');
}

if (require.main === module) {
  main();
}

export { analyzeIssue, inferEdgeCases, generatePriorityMatrix };
