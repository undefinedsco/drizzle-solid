#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

type SolidStatus = 'direct' | 'adapted' | 'investigate' | 'skip';
type Priority = 'P0' | 'P1' | 'P2' | 'P3';

interface CliOptions {
  source: string;
  outDir: string;
}

interface ParityCase {
  id: string;
  sourceFile: string;
  sourceLine: number;
  dialect: string;
  suitePath: string[];
  testName: string;
  callVariant: string;
  tags: string[];
  solidStatus: SolidStatus;
  priority: Priority;
  reasons: string[];
  suggestedTargetFile: string;
  needsFixture: boolean;
  needsManualAssertion: boolean;
  dedupeKey: string;
  bodyPreview: string;
}

interface QueueItem {
  dedupeKey: string;
  representativeId: string;
  title: string;
  suitePath: string[];
  solidStatus: SolidStatus;
  priority: Priority;
  suggestedTargetFile: string;
  tags: string[];
  reasons: string[];
  needsFixture: boolean;
  needsManualAssertion: boolean;
  variants: Array<{
    id: string;
    sourceFile: string;
    sourceLine: number;
    dialect: string;
    testName: string;
  }>;
}

interface OutputManifest {
  generatedAt: string;
  sourceRoot: string;
  totalFiles: number;
  totalTests: number;
  totalUniqueCases: number;
  totalsByStatus: Record<SolidStatus, number>;
  totalsByPriority: Record<Priority, number>;
  cases: ParityCase[];
}

interface OutputQueue {
  generatedAt: string;
  sourceRoot: string;
  totalItems: number;
  totalsByStatus: Record<SolidStatus, number>;
  totalsByPriority: Record<Priority, number>;
  items: QueueItem[];
}

const DEFAULT_SOURCE = '/tmp/drizzle-orm';
const DEFAULT_OUT_DIR = 'tests/fixtures/drizzle-parity';

const SKIP_PATH_SEGMENTS = [
  'extensions',
  'imports',
  'replicas',
  'seeder',
  'utils',
  'gel',
];

const SELECTION_STANDARD_LINES = [
  'Prefer migration-relevant Drizzle public API behavior over raw test count.',
  'Deduplicate repeated dialect variants and keep one representative parity case per behavior unit.',
  'Only promote cases that can run against a real Solid Pod/CSS flow; do not keep SQL-engine-only placeholders.',
  '`direct` = core CRUD/query-builder behavior; `adapted` = Solid fixtures/assertions required; `investigate` = semantics still need design; `skip` = SQL/driver-specific surface.',
  '`needsFixture` and `needsManualAssertion` stay explicit so generated output never pretends a case is plug-and-play when it is not.',
] as const;

const ACTIVE_STATUS_ORDER: SolidStatus[] = ['direct', 'adapted', 'investigate'];
const PRIORITY_ORDER: Priority[] = ['P0', 'P1', 'P2', 'P3'];
const ACTIVE_STATUS_LABELS: Record<SolidStatus, { heading: string; guidance: string }> = {
  direct: {
    heading: 'Ready First',
    guidance: 'Public API behavior that should be implemented and verified first with real Solid fixtures.',
  },
  adapted: {
    heading: 'Adapt Next',
    guidance: 'High-value parity items that need Solid-specific fixture layout and adjusted assertions.',
  },
  investigate: {
    heading: 'Investigate Later',
    guidance: 'Semantics or API surface still need design decisions before implementation work starts.',
  },
  skip: {
    heading: 'Skip',
    guidance: 'Excluded from board generation.',
  },
};

const IMPLEMENTED_PARITY_CASES = new Set([
  'tests/integration/css/drizzle-crud.test.ts::common › insert many',
  'tests/integration/css/drizzle-crud.test.ts::common › insert + select',
  'tests/integration/css/drizzle-crud.test.ts::common › select all fields',
  'tests/integration/css/drizzle-crud.test.ts::common › select partial',
  'tests/integration/css/drizzle-features.test.ts::common › insert many',
  'tests/integration/css/drizzle-features.test.ts::common › insert + select',
  'tests/integration/css/drizzle-features.test.ts::limit 0',
  'tests/integration/css/drizzle-features.test.ts::common › cross join',
  'tests/integration/css/drizzle-joins.test.ts::common › left join (all fields)',
  'tests/integration/css/drizzle-joins.test.ts::common › left join (flat object fields)',
  'tests/integration/css/drizzle-joins.test.ts::common › left join (grouped fields)',
  'tests/integration/css/drizzle-joins.test.ts::common › partial join with alias',
  'tests/integration/css/drizzle-aggregations.test.ts::common › aggregate function: avg',
  'tests/integration/css/drizzle-aggregations.test.ts::common › aggregate function: count',
  'tests/integration/css/drizzle-aggregations.test.ts::common › aggregate function: max',
  'tests/integration/css/drizzle-aggregations.test.ts::common › aggregate function: min',
  'tests/integration/css/drizzle-aggregations.test.ts::common › aggregate function: sum',
  'tests/integration/css/drizzle-aggregations.test.ts::common › build query',
  'tests/integration/css/drizzle-aggregations.test.ts::common › select with group by as field',
  'tests/integration/css/drizzle-types.test.ts::array types',
  'tests/integration/css/drizzle-types.test.ts::char insert',
  'tests/integration/css/drizzle-types.test.ts::common › $default function',
  'tests/integration/css/drizzle-types.test.ts::common › insert bigint values',
  'tests/integration/css/drizzle-types.test.ts::insert + select all possible dates',
  'tests/integration/css/drizzle-types.test.ts::common › insert with default values',
  'tests/integration/css/drizzle-types.test.ts::common › insert with overridden default values',
  'tests/integration/css/drizzle-types.test.ts::common › json insert',
  'tests/integration/css/drizzle-types.test.ts::select bigint',
  'tests/integration/css/drizzle-types.test.ts::common › timestamp timezone',
  'tests/integration/css/drizzle-operators.test.ts::char delete',
  'tests/integration/css/drizzle-operators.test.ts::char update',
  'tests/integration/css/drizzle-batch.test.ts::common › batch api example',
  'tests/integration/css/drizzle-batch.test.ts::common › insert + delete + select + select partial',
  'tests/integration/css/drizzle-batch.test.ts::common › insert + update + select + select partial',
  'tests/integration/css/drizzle-returning.test.ts::common › delete with returning all fields',
  'tests/integration/css/drizzle-returning.test.ts::common › delete with returning partial',
  'tests/integration/css/drizzle-returning.test.ts::common › update with returning all fields',
  'tests/integration/css/drizzle-returning.test.ts::common › update with returning partial',
  'tests/integration/css/drizzle-returning.test.ts::common › insert many with returning',
  'tests/integration/css/drizzle-batch.test.ts::findMany + findOne api example',
  'tests/integration/css/drizzle-batch.test.ts::common › insert + findMany',
  'tests/integration/css/drizzle-batch.test.ts::common › insert + findMany + findFirst',
  'tests/integration/css/drizzle-returning.test.ts::insert with array values works',
  'tests/integration/css/drizzle-returning.test.ts::update with array values works',
  'tests/integration/css/drizzle-query-api.test.ts::Filter by columns not present in select',
  'tests/integration/css/drizzle-query-api.test.ts::[Find Many] Get users with posts',
  'tests/integration/css/drizzle-query-api.test.ts::[Find Many] Get users with posts + where',
  'tests/integration/css/drizzle-query-api.test.ts::[Find Many] Get users with posts + orderBy',
  'tests/integration/css/drizzle-query-api.test.ts::[Find One] Get users with posts',
  'tests/integration/css/drizzle-query-api.test.ts::[Find One] Get users with posts + where',
  'tests/integration/css/drizzle-query-api.test.ts::[Find One] Get users with posts no results found',
  'tests/integration/css/drizzle-query-api.test.ts::[Find Many] Get users with posts + where + partial',
  'tests/integration/css/drizzle-query-api.test.ts::[Find One] Get users with posts + orderBy',
  'tests/integration/css/drizzle-query-api.test.ts::[Find One] Get users with posts + where + partial',
].map((entry) => normalizeForDedupe(entry)));

const TAG_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'select', patterns: [/\.select\(/i, /\bselect\b/i] },
  { tag: 'insert', patterns: [/\.insert\(/i] },
  { tag: 'update', patterns: [/\.update\(/i] },
  { tag: 'delete', patterns: [/\.delete\(/i] },
  { tag: 'where', patterns: [/\.where\(/i] },
  { tag: 'eq', patterns: [/\beq\(/i] },
  { tag: 'ne', patterns: [/\bne\(/i] },
  { tag: 'gt', patterns: [/\bgt\(/i] },
  { tag: 'gte', patterns: [/\bgte\(/i] },
  { tag: 'lt', patterns: [/\blt\(/i] },
  { tag: 'lte', patterns: [/\blte\(/i] },
  { tag: 'and', patterns: [/\band\(/i] },
  { tag: 'or', patterns: [/\bor\(/i] },
  { tag: 'not', patterns: [/\bnot\(/i] },
  { tag: 'in-array', patterns: [/\binArray\(/i] },
  { tag: 'not-in-array', patterns: [/\bnotInArray\(/i] },
  { tag: 'like', patterns: [/\blike\(/i, /\bilike\(/i, /notLike/i, /notIlike/i] },
  { tag: 'order-by', patterns: [/\.orderBy\(/i, /orderBy/i] },
  { tag: 'limit', patterns: [/\.limit\(/i, /\blimit\b/i] },
  { tag: 'negative-limit', patterns: [/limit -1/i, /\.limit\(-1\)/i] },
  { tag: 'offset', patterns: [/\.offset\(/i, /\boffset\b/i] },
  { tag: 'distinct', patterns: [/\.distinct\(/i, /countDistinct\(/i, /avgDistinct\(/i, /sumDistinct\(/i, /select distinct/i] },
  { tag: 'join-left', patterns: [/\.leftJoin\(/i, /left join/i] },
  { tag: 'join-inner', patterns: [/\.innerJoin\(/i, /inner join/i] },
  { tag: 'join-cross', patterns: [/\.crossJoin\(/i, /cross join/i] },
  { tag: 'join-right', patterns: [/\.rightJoin\(/i, /right join/i] },
  { tag: 'join-full', patterns: [/\.fullJoin\(/i, /full join/i] },
  { tag: 'group-by', patterns: [/\.groupBy\(/i, /group by/i] },
  { tag: 'having', patterns: [/\.having\(/i, /\bhaving\b/i] },
  { tag: 'aggregation-count', patterns: [/\bcount\(/i, /\$count/i] },
  { tag: 'aggregation-sum', patterns: [/\bsum\(/i] },
  { tag: 'aggregation-avg', patterns: [/\bavg\(/i] },
  { tag: 'aggregation-min', patterns: [/\bmin\(/i] },
  { tag: 'aggregation-max', patterns: [/\bmax\(/i] },
  { tag: 'batch', patterns: [/\.batch\(/i, /batch/i] },
  { tag: 'cache', patterns: [/cache/i, /invalidate/i, /onMutate/i] },
  { tag: 'driver-api', patterns: [/db\.execute\(/i, /db\.run\(/i, /db\.get\(/i, /db\.all\(/i, /db\.values\(/i] },
  { tag: 'auth-wrapper', patterns: [/\$withAuth/i] },
  { tag: 'migrator', patterns: [/\bmigrator\b/i, /\bmigrate\b/i] },
  { tag: 'transaction', patterns: [/\.transaction\(/i, /nested transaction/i, /transaction rollback/i, /^transaction$/i] },
  { tag: 'prepared', patterns: [/\.prepare\(/i, /prepared statement/i, /placeholder/i] },
  { tag: 'returning', patterns: [/\.returning\(/i, /returning/i] },
  { tag: 'query-api', patterns: [/db\.query\./i, /findMany/i, /findFirst/i, /findById/i] },
  { tag: 'raw-sql', patterns: [/from\(sql`/i, /raw sql/i, /\bselect sql\b/i, /\btyped sql\b/i, /\binsert sql\b/i] },
  { tag: 'sql-fragment', patterns: [/\bsql`/i, /\bsql\(/i, /\bas sql\b/i, /returning sql/i, /subquery sql/i, /sql operator/i] },
  { tag: 'json-operator', patterns: [/->>/i, /->/i] },
  { tag: 'locking', patterns: [/select for/i, /for update/i, /for share/i] },
  { tag: 'query-check', patterns: [/^query check:/i, /query check:/i] },
  { tag: 'with-cte', patterns: [/\.\$with\(/i, /^with\s+\.\.\./i, /with \.\.\./i] },
  { tag: 'subquery', patterns: [/subquery/i, /\.as\(/i] },
  { tag: 'exists', patterns: [/\bexists\(/i] },
  { tag: 'set-operation', patterns: [/\bunion\(/i, /\bunionAll\(/i, /\bintersect\(/i, /\bexcept\(/i, /set operations/i] },
  { tag: 'on-conflict', patterns: [/onConflict/i, /do nothing/i, /do update/i] },
  { tag: 'on-duplicate', patterns: [/onDuplicate/i, /onDuplicateKeyUpdate/i] },
  { tag: 'auto-increment', patterns: [/autoIncrement/i, /auto increment/i] },
  { tag: 'foreign-key', patterns: [/foreign key/i, /references\(/i] },
  { tag: 'view', patterns: [/sqliteView\(/i, /getViewConfig\(/i, /^view$/i] },
  { tag: 'index', patterns: [/\bindex\(/i, /unique\(/i, /constraints/i] },
  { tag: 'async-api', patterns: [/async api/i] },
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    source: DEFAULT_SOURCE,
    outDir: DEFAULT_OUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--source') {
      options.source = argv[index + 1] ?? options.source;
      index += 1;
      continue;
    }
    if (value === '--outDir') {
      options.outDir = argv[index + 1] ?? options.outDir;
      index += 1;
      continue;
    }
  }

  return options;
}

function resolveSourceRoot(source: string): string {
  const resolved = path.resolve(source);
  const testsRoot = path.join(resolved, 'integration-tests', 'tests');

  if (fs.existsSync(testsRoot)) {
    return testsRoot;
  }

  if (fs.existsSync(resolved) && path.basename(resolved) === 'tests') {
    return resolved;
  }

  throw new Error(
    `Cannot find Drizzle integration tests under ${resolved}. `
      + 'Pass --source /path/to/drizzle-orm or --source /path/to/drizzle-orm/integration-tests/tests.',
  );
}

function walkTsFiles(rootDir: string): string[] {
  const files: string[] = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) {
        continue;
      }

      files.push(entryPath);
    }
  }

  return files.sort();
}

function getCallPath(expression: ts.LeftHandSideExpression): string[] {
  if (ts.isIdentifier(expression)) {
    return [expression.text];
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return [...getCallPath(expression.expression), expression.name.text];
  }

  if (ts.isCallExpression(expression)) {
    return getCallPath(expression.expression);
  }

  return [];
}

function readStringLiteral(node: ts.Expression | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  return undefined;
}

function getCallback(call: ts.CallExpression): ts.FunctionLikeDeclaration | undefined {
  for (let index = call.arguments.length - 1; index >= 0; index -= 1) {
    const argument = call.arguments[index];
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      return argument;
    }
  }

  return undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function previewBody(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(' ')
    .slice(0, 280);
}

function normalizeForDedupe(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b(sqlite|mysql|postgres|postgresql|pg|singlestore|libsql|d1|turso|gel|neon|vercel|bun|awsdatapi|proxy|custom|cache|common)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectTags(relativeFile: string, suitePath: string[], testName: string, bodyText: string): string[] {
  const haystack = `${relativeFile}\n${suitePath.join(' ')}\n${testName}\n${bodyText}`;
  const tags = new Set<string>();

  for (const definition of TAG_PATTERNS) {
    if (definition.patterns.some((pattern) => pattern.test(haystack))) {
      tags.add(definition.tag);
    }
  }

  if (relativeFile.includes('/pg/')) {
    tags.add('dialect-pg');
  }
  if (relativeFile.includes('/mysql/')) {
    tags.add('dialect-mysql');
  }
  if (relativeFile.includes('/sqlite/')) {
    tags.add('dialect-sqlite');
  }
  if (relativeFile.includes('/singlestore/')) {
    tags.add('dialect-singlestore');
  }
  if (relativeFile.includes('/relational/')) {
    tags.add('relational-suite');
  }

  return [...tags].sort();
}

function getPathSegments(relativeFile: string): string[] {
  return relativeFile.split('/').filter(Boolean);
}

/**
 * Selection standard for upstream Drizzle samples:
 * - Prefer migration-relevant public API behavior over raw volume.
 * - Keep one representative parity case per behavior after dialect dedupe.
 * - Only classify as `direct` when a case can be executed with real Solid fixtures.
 * - Route Solid-specific rewrites into `adapted` / `investigate` instead of generating placeholder tests.
 * - Skip SQL-engine or driver-only semantics that do not belong to the Solid parity surface.
 */
function classifyCase(relativeFile: string, testName: string, tags: Set<string>): { solidStatus: SolidStatus; priority: Priority; reasons: string[] } {
  const reasons: string[] = [];
  const lowerFile = relativeFile.toLowerCase();
  const lowerName = testName.toLowerCase();
  const pathSegments = getPathSegments(lowerFile);

  if (SKIP_PATH_SEGMENTS.some((segment) => pathSegments.includes(segment))) {
    reasons.push('Driver/infrastructure-specific suite, not Solid parity surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerFile.endsWith('version.test.ts')) {
    reasons.push('Version/import verification does not map to Solid query behavior.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('transaction')) {
    reasons.push('ACID transaction semantics do not map directly onto Solid Pod operations.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('auto-increment')) {
    reasons.push('Auto-increment behavior is SQL-specific; Solid typically uses explicit IDs/URIs.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('view') || tags.has('foreign-key') || tags.has('index')) {
    reasons.push('Schema-level SQL features need separate Solid-native modeling, not direct parity tests.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('locking')) {
    reasons.push('Row-level locking semantics are SQL-specific and do not map to Solid Pod operations.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('query-check')) {
    reasons.push('Query string generation checks are compiler-level SQL tests, not Solid runtime parity behavior.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('json-operator')) {
    reasons.push('SQL JSON operators do not map directly onto the Solid query-builder surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName === '.tosql()' || lowerName === 'tosql' || lowerName.includes('tosql')) {
    reasons.push('`toSQL()` is intentionally not exposed in the Solid dialect; use `toSPARQL()` / `toSparql()` instead.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('raw-sql')) {
    reasons.push('Raw SQL is intentionally out of scope for the Solid dialect; raw escape hatches use SPARQL only.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('cache')) {
    reasons.push('Cache config and invalidation policy are runtime-specific, not part of the current Solid parity surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('migrator')) {
    reasons.push('Migration tooling is infrastructure-specific and outside the current Solid adapter parity scope.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('driver-api')) {
    reasons.push('Driver escape-hatch APIs like db.execute/db.run/db.get/db.all are not part of the current Solid parity surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('auth-wrapper')) {
    reasons.push('Driver-specific auth wrapper coverage is infrastructure behavior, not Solid query-builder parity.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('custom binary') || lowerName.includes('network types')) {
    reasons.push('Database-specific binary/network type coverage does not map cleanly onto Solid RDF storage.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('myschema') || lowerName.includes('prefixed table')) {
    reasons.push('SQL schema-qualified table coverage does not map directly onto the Solid parity surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('join-right') || tags.has('join-full')) {
    reasons.push('`rightJoin`/`fullJoin` are not implemented in the current Solid dialect surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('sql-fragment')) {
    reasons.push('`sql` fragment helpers are intentionally out of scope for the Solid dialect; use native builder APIs or SPARQL escape hatches instead.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName === 'skip') {
    reasons.push('Placeholder upstream test names do not represent a Solid parity feature.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('db.execute') || lowerName.includes('db.get')) {
    reasons.push('Driver escape-hatch APIs like db.execute/db.get are not part of the current Solid parity surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('update ... from')) {
    reasons.push('`update ... from` semantics are SQL-specific and not part of the current Solid dialect surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('async api') || lowerName.includes('prepare') || lowerName.includes('sync()')) {
    reasons.push('Prepared/async driver orchestration cases are not part of the current Solid parity surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('typehints') || lowerName.includes('dbname & tsname')) {
    reasons.push('Type-level or schema-name inference checks are compile-time concerns, not runtime Solid parity behavior.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (
    lowerName.includes('groups with users')
    || lowerName.includes('users with groups')
    || lowerName.includes('invitee')
    || lowerName.includes('deep select {}')
    || lowerName.includes('select {}')
    || lowerName.includes('only custom fields')
    || lowerName.includes('custom fields')
    || lowerName.includes('partial(false)')
    || lowerName.includes('partial(true')
    || lowerName.includes('did not select')
    || lowerName.includes('limit posts')
    || lowerName.includes('posts with comments')
    || lowerName.includes('simple case from gh')
  ) {
    reasons.push('This query-api case depends on nested relation shaping, many-to-many traversal, or relation-level projection controls that are not part of the current Solid query facade surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('$returningid') || lowerName.includes('serial as id') || lowerName.includes('primary key')) {
    reasons.push('Auto-increment / serial / SQL primary-key returning helpers do not map directly onto Solid resource identifiers.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('lateral')) {
    reasons.push('Lateral/subquery join semantics are not part of the current Solid parity surface and need separate design.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (lowerName.includes('join subquery') || lowerName.includes('select from a many subquery')) {
    reasons.push('Subquery builders are not part of the current Solid dialect surface; keep joins and aggregations on native table sources only.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (
    lowerName.includes('cross join (lateral)')
    || lowerName.includes('set operations')
    || lowerName.includes('onconflict')
    || lowerName.includes('onduplicate')
    || lowerName.includes('insert conflict')
    || lowerName.includes('limit -1')
    || lowerName.includes('delete with limit and order by')
    || lowerName.includes('update with limit and order by')
    || lowerName.includes('enable rls')
    || lowerName.includes('neon_auth')
    || lowerName.includes('placeholders on columns with encoder')
    || lowerName.includes('select a field without joining its table')
    || lowerName.includes('select all fields from subquery without alias')
    || lowerName.includes('select from a one subquery')
    || lowerName.includes('signed ints')
    || lowerName.includes('unsigned ints')
    || lowerName.includes('jsonb')
    || lowerName.includes('->> operator')
  ) {
    reasons.push('This case depends on SQL-native semantics, driver-specific behavior, or subquery/set-operation features that are outside the current Solid parity surface.');
    return { solidStatus: 'skip', priority: 'P3', reasons };
  }

  if (tags.has('join-cross')) {
    reasons.push('Cross join semantics need adapted fixtures and assertions before parity implementation.');
    return { solidStatus: 'adapted', priority: 'P1', reasons };
  }

  if (tags.has('on-conflict') || tags.has('on-duplicate') || (tags.has('insert') && lowerName.includes('conflict'))) {
    reasons.push('Conflict/upsert semantics require Solid-specific design before parity implementation.');
    return { solidStatus: 'investigate', priority: 'P3', reasons };
  }

  if (tags.has('prepared') || tags.has('with-cte') || tags.has('set-operation') || tags.has('subquery')) {
    reasons.push('Advanced builder behavior likely needs manual adaptation for Solid execution.');
    return { solidStatus: 'investigate', priority: 'P2', reasons };
  }

  if (tags.has('query-api') || tags.has('batch') || tags.has('having') || tags.has('exists') || tags.has('returning') || tags.has('async-api')) {
    reasons.push('API shape overlaps with Drizzle, but assertions and fixtures must be designed manually for Solid.');
    return { solidStatus: 'investigate', priority: 'P2', reasons };
  }

  if (tags.has('negative-limit')) {
    reasons.push('Negative limit semantics are not part of the current Solid query-builder contract and need design review.');
    return { solidStatus: 'investigate', priority: 'P3', reasons };
  }

  if ((tags.has('delete') || tags.has('update')) && tags.has('limit') && tags.has('order-by')) {
    reasons.push('Update/delete with orderBy+limit need dedicated Solid semantics before parity implementation.');
    return { solidStatus: 'investigate', priority: 'P2', reasons };
  }

  if (
    tags.has('join-left')
    || tags.has('join-inner')
    || tags.has('group-by')
    || tags.has('aggregation-count')
    || tags.has('aggregation-sum')
    || tags.has('aggregation-avg')
    || tags.has('aggregation-min')
    || tags.has('aggregation-max')
    || tags.has('distinct')
  ) {
    reasons.push('Feature is supported or planned in Solid, but requires multi-resource fixtures and adapted assertions.');
    return { solidStatus: 'adapted', priority: 'P1', reasons };
  }

  if (tags.has('order-by') || tags.has('limit') || tags.has('offset') || tags.has('where')) {
    reasons.push('Core query-builder behavior should map directly with Solid-specific fixtures.');
    return { solidStatus: 'direct', priority: 'P0', reasons };
  }

  if (tags.has('select') || tags.has('insert') || tags.has('update') || tags.has('delete')) {
    reasons.push('Core CRUD parity candidate.');
    return { solidStatus: 'direct', priority: 'P0', reasons };
  }

  if (lowerName.includes('join') || lowerName.includes('aggregate')) {
    reasons.push('Name suggests complex query behavior that needs adapted assertions.');
    return { solidStatus: 'adapted', priority: 'P1', reasons };
  }

  reasons.push('Needs human review before deciding parity value.');
  return { solidStatus: 'investigate', priority: 'P2', reasons };
}

function isTypeParityCase(testName: string, suitePath: string[], tags: Set<string>): boolean {
  const title = [suitePath.join(' '), testName].join(' ').toLowerCase();
  return [
    'array types',
    'char insert',
    'insert bigint values',
    'select bigint',
    'select large integer',
    'timestamp timezone',
    'json insert',
    'all possible dates',
    'default values',
    '$default function',
    'with spaces',
  ].some((token) => title.includes(token))
    || tags.has('not-in-array')
    || (tags.has('in-array') && title.includes('empty array'));
}

function inferTargetFile(testName: string, suitePath: string[], tags: Set<string>, solidStatus: SolidStatus): string {
  if (solidStatus === 'skip') {
    return 'tests/fixtures/drizzle-parity/skipped.todo.md';
  }

  if (isTypeParityCase(testName, suitePath, tags)) {
    return 'tests/integration/css/drizzle-types.test.ts';
  }

  if (tags.has('join-left') || tags.has('join-inner') || tags.has('join-right') || tags.has('join-full')) {
    return 'tests/integration/css/drizzle-joins.test.ts';
  }

  if (
    tags.has('aggregation-count')
    || tags.has('aggregation-sum')
    || tags.has('aggregation-avg')
    || tags.has('aggregation-min')
    || tags.has('aggregation-max')
    || tags.has('group-by')
    || tags.has('having')
  ) {
    return 'tests/integration/css/drizzle-aggregations.test.ts';
  }

  if (tags.has('batch') || tags.has('transaction')) {
    return 'tests/integration/css/drizzle-batch.test.ts';
  }

  if (tags.has('query-api')) {
    return 'tests/integration/css/drizzle-query-api.test.ts';
  }

  if (tags.has('returning')) {
    return 'tests/integration/css/drizzle-returning.test.ts';
  }

  if (tags.has('order-by') || tags.has('limit') || tags.has('offset') || tags.has('distinct')) {
    return 'tests/integration/css/drizzle-features.test.ts';
  }

  if (
    tags.has('eq')
    || tags.has('ne')
    || tags.has('gt')
    || tags.has('gte')
    || tags.has('lt')
    || tags.has('lte')
    || tags.has('and')
    || tags.has('or')
    || tags.has('not')
    || tags.has('in-array')
    || tags.has('not-in-array')
    || tags.has('like')
  ) {
    return 'tests/integration/css/drizzle-operators.test.ts';
  }

  if (solidStatus === 'investigate') {
    return 'tests/integration/css/drizzle-parity-investigate.test.ts';
  }

  return 'tests/integration/css/drizzle-crud.test.ts';
}

function buildDedupeKey(testName: string, suitePath: string[], tags: Set<string>): string {
  const normalizedTitle = normalizeForDedupe(testName);
  const normalizedSuite = normalizeForDedupe(suitePath.join(' '));
  const stableTags = [...tags]
    .filter((tag) => !tag.startsWith('dialect-'))
    .filter((tag) => tag !== 'relational-suite')
    .sort()
    .slice(0, 8);

  return [normalizedSuite, normalizedTitle, stableTags.join('+')].filter(Boolean).join('::');
}

function extractCasesFromFile(sourceRoot: string, filePath: string): ParityCase[] {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!/\b(test|it)\s*\(/.test(content)) {
    return [];
  }

  const relativeFile = path.relative(sourceRoot, filePath).replace(/\\/g, '/');
  const dialect = relativeFile.split('/')[0] || 'unknown';
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cases: ParityCase[] = [];

  const visitNode = (node: ts.Node, suitePath: string[]) => {
    if (ts.isCallExpression(node)) {
      const callPath = getCallPath(node.expression);
      const baseName = callPath[0];
      const variant = callPath.join('.');

      if ((baseName === 'describe' || baseName === 'suite') && node.arguments.length > 0) {
        const name = readStringLiteral(node.arguments[0]);
        const callback = getCallback(node);
        if (name && callback?.body) {
          visitNode(callback.body, [...suitePath, name]);
          return;
        }
      }

      if ((baseName === 'test' || baseName === 'it') && node.arguments.length > 0) {
        const name = readStringLiteral(node.arguments[0]);
        const callback = getCallback(node);
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

        if (name) {
          const bodyText = callback?.body?.getText(sourceFile) ?? '';
          const tags = new Set(collectTags(relativeFile, suitePath, name, bodyText));
          const classification = classifyCase(relativeFile, name, tags);
          const suggestedTargetFile = inferTargetFile(name, suitePath, tags, classification.solidStatus);
          const dedupeKey = buildDedupeKey(name, suitePath, tags);

          cases.push({
            id: `${relativeFile}:${line}:${slugify(`${suitePath.join(' ')} ${name}`)}`,
            sourceFile: relativeFile,
            sourceLine: line,
            dialect,
            suitePath,
            testName: name,
            callVariant: variant,
            tags: [...tags].sort(),
            solidStatus: classification.solidStatus,
            priority: classification.priority,
            reasons: classification.reasons,
            suggestedTargetFile,
            needsFixture: classification.solidStatus !== 'skip' && (tags.has('join-left') || tags.has('join-inner') || tags.has('group-by') || tags.has('aggregation-count') || tags.has('aggregation-sum') || tags.has('aggregation-avg') || tags.has('aggregation-min') || tags.has('aggregation-max') || tags.has('batch') || tags.has('query-api')),
            needsManualAssertion: classification.solidStatus !== 'direct',
            dedupeKey,
            bodyPreview: previewBody(bodyText),
          });

          return;
        }
      }
    }

    ts.forEachChild(node, (child) => visitNode(child, suitePath));
  };

  visitNode(sourceFile, []);
  return cases;
}

function bumpRecord<T extends string>(record: Record<T, number>, key: T) {
  record[key] += 1;
}

function buildQueue(cases: ParityCase[]): QueueItem[] {
  const grouped = new Map<string, ParityCase[]>();

  for (const parityCase of cases) {
    const group = grouped.get(parityCase.dedupeKey) ?? [];
    group.push(parityCase);
    grouped.set(parityCase.dedupeKey, group);
  }

  const queue: QueueItem[] = [];

  const getRepresentativeWeight = (parityCase: ParityCase): string => {
    const file = parityCase.sourceFile;
    let sourceWeight = '9';

    if (file.includes('sqlite-common.ts')) {
      sourceWeight = '0';
    } else if (file.includes('/sqlite/')) {
      sourceWeight = '1';
    } else if (file.includes('/pg/')) {
      sourceWeight = '2';
    } else if (file.includes('/mysql/')) {
      sourceWeight = '3';
    } else if (file.includes('/relational/')) {
      sourceWeight = '4';
    } else if (file.includes('/bun/')) {
      sourceWeight = '5';
    }

    const statusWeight = {
      direct: '0',
      adapted: '1',
      investigate: '2',
      skip: '3',
    }[parityCase.solidStatus];

    const priorityWeight = {
      P0: '0',
      P1: '1',
      P2: '2',
      P3: '3',
    }[parityCase.priority];

    return `${statusWeight}:${priorityWeight}:${sourceWeight}:${parityCase.sourceFile}:${parityCase.sourceLine}`;
  };

  for (const [dedupeKey, variants] of grouped.entries()) {
    const representative = [...variants].sort((left, right) => {
      const leftScore = getRepresentativeWeight(left);
      const rightScore = getRepresentativeWeight(right);
      return leftScore.localeCompare(rightScore);
    })[0];

    queue.push({
      dedupeKey,
      representativeId: representative.id,
      title: representative.testName,
      suitePath: representative.suitePath,
      solidStatus: representative.solidStatus,
      priority: representative.priority,
      suggestedTargetFile: representative.suggestedTargetFile,
      tags: representative.tags,
      reasons: representative.reasons,
      needsFixture: variants.some((item) => item.needsFixture),
      needsManualAssertion: representative.needsManualAssertion,
      variants: variants
        .map((item) => ({
          id: item.id,
          sourceFile: item.sourceFile,
          sourceLine: item.sourceLine,
          dialect: item.dialect,
          testName: item.testName,
        }))
        .sort((left, right) => `${left.sourceFile}:${left.sourceLine}`.localeCompare(`${right.sourceFile}:${right.sourceLine}`)),
    });
  }

  return queue.sort((left, right) => {
    const leftKey = `${left.priority}:${left.solidStatus}:${left.suggestedTargetFile}:${normalizeForDedupe(left.title)}`;
    const rightKey = `${right.priority}:${right.solidStatus}:${right.suggestedTargetFile}:${normalizeForDedupe(right.title)}`;
    return leftKey.localeCompare(rightKey);
  });
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function buildImplementedCaseKey(item: QueueItem): string {
  const suiteLabel = item.suitePath.length > 0 ? `${item.suitePath.join(' › ')} › ` : '';
  return normalizeForDedupe(`${item.suggestedTargetFile}::${suiteLabel}${item.title}`);
}

function isImplementedParityCase(item: QueueItem): boolean {
  return IMPLEMENTED_PARITY_CASES.has(buildImplementedCaseKey(item));
}

function buildSummary(manifest: OutputManifest, queue: OutputQueue): string {
  const lines: string[] = [];

  lines.push('# Drizzle Parity Summary');
  lines.push('');
  lines.push(`- Generated: ${manifest.generatedAt}`);
  lines.push(`- Source root: \`${manifest.sourceRoot}\``);
  lines.push(`- Parsed files: ${manifest.totalFiles}`);
  lines.push(`- Parsed tests: ${manifest.totalTests}`);
  lines.push(`- Unique parity cases: ${manifest.totalUniqueCases}`);
  lines.push('');
  lines.push('## By Status');
  lines.push('');
  lines.push('| Status | Raw tests | Unique cases |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| direct | ${manifest.totalsByStatus.direct} | ${queue.totalsByStatus.direct} |`);
  lines.push(`| adapted | ${manifest.totalsByStatus.adapted} | ${queue.totalsByStatus.adapted} |`);
  lines.push(`| investigate | ${manifest.totalsByStatus.investigate} | ${queue.totalsByStatus.investigate} |`);
  lines.push(`| skip | ${manifest.totalsByStatus.skip} | ${queue.totalsByStatus.skip} |`);
  lines.push('');
  lines.push('## By Priority');
  lines.push('');
  lines.push('| Priority | Raw tests | Unique cases |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| P0 | ${manifest.totalsByPriority.P0} | ${queue.totalsByPriority.P0} |`);
  lines.push(`| P1 | ${manifest.totalsByPriority.P1} | ${queue.totalsByPriority.P1} |`);
  lines.push(`| P2 | ${manifest.totalsByPriority.P2} | ${queue.totalsByPriority.P2} |`);
  lines.push(`| P3 | ${manifest.totalsByPriority.P3} | ${queue.totalsByPriority.P3} |`);
  lines.push('');
  lines.push('## Suggested Targets');
  lines.push('');

  const targets = new Map<string, number>();
  for (const item of queue.items) {
    if (item.solidStatus === 'skip') {
      continue;
    }
    targets.set(item.suggestedTargetFile, (targets.get(item.suggestedTargetFile) ?? 0) + 1);
  }

  for (const [target, count] of [...targets.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    lines.push(`- \`${target}\`: ${count} unique cases`);
  }

  lines.push('');
  lines.push('## Selection Standard');
  lines.push('');
  for (const line of SELECTION_STANDARD_LINES) {
    lines.push(`- ${line}`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- `all-tests.json` keeps every upstream `test()` / `it()` occurrence.');
  lines.push('- `queue.json` deduplicates repeated dialect variants and is the main implementation queue.');
  lines.push('- `tests/integration/css/generated-parity/*.parity.todo.test.ts` emits one `test.todo()` skeleton per non-skip, not-yet-implemented queue item.');
  lines.push('- Queue items marked `direct` are the best first wave for Solid parity implementation.');
  lines.push('- Queue items marked `adapted` or `investigate` still need hand-written fixtures and assertions.');

  return `${lines.join('\n')}\n`;
}

function writeQueueBoards(outDir: string, queue: QueueItem[]) {
  const boardDir = path.join(outDir, 'boards');
  ensureDir(boardDir);

  const grouped = new Map<string, QueueItem[]>();
  for (const item of queue) {
    const key = path.basename(item.suggestedTargetFile, path.extname(item.suggestedTargetFile));
    const entries = grouped.get(key) ?? [];
    entries.push(item);
    grouped.set(key, entries);
  }

  const sortItems = (items: QueueItem[]) => [...items].sort((left, right) => {
    const leftKey = [
      ACTIVE_STATUS_ORDER.indexOf(left.solidStatus as SolidStatus).toString().padStart(2, '0'),
      PRIORITY_ORDER.indexOf(left.priority as Priority).toString().padStart(2, '0'),
      left.needsFixture ? '1' : '0',
      left.needsManualAssertion ? '1' : '0',
      normalizeForDedupe(left.title),
    ].join(':');

    const rightKey = [
      ACTIVE_STATUS_ORDER.indexOf(right.solidStatus as SolidStatus).toString().padStart(2, '0'),
      PRIORITY_ORDER.indexOf(right.priority as Priority).toString().padStart(2, '0'),
      right.needsFixture ? '1' : '0',
      right.needsManualAssertion ? '1' : '0',
      normalizeForDedupe(right.title),
    ].join(':');

    return leftKey.localeCompare(rightKey);
  });

  for (const [groupName, rawItems] of grouped.entries()) {
    const items = sortItems(rawItems);
    const lines: string[] = [];
    lines.push(`# ${groupName} parity board`);
    lines.push('');
    lines.push(`- Total unique cases: ${items.length}`);
    lines.push(`- Recommended flow: ${ACTIVE_STATUS_ORDER.map((status) => `${ACTIVE_STATUS_LABELS[status].heading} (${status})`).join(' → ')}`);
    lines.push('- Legend: `fixture=yes/no`, `manual=yes/no`');
    lines.push('');

    for (const status of ACTIVE_STATUS_ORDER) {
      const statusItems = items.filter((item) => item.solidStatus === status);
      if (statusItems.length === 0) {
        continue;
      }

      lines.push(`## ${ACTIVE_STATUS_LABELS[status].heading}`);
      lines.push('');
      lines.push(`- Status: \`${status}\``);
      lines.push(`- Count: ${statusItems.length}`);
      lines.push(`- Guidance: ${ACTIVE_STATUS_LABELS[status].guidance}`);
      lines.push('');

      for (const priority of PRIORITY_ORDER) {
        const priorityItems = statusItems.filter((item) => item.priority === priority);
        if (priorityItems.length === 0) {
          continue;
        }

        lines.push(`### ${priority}`);
        lines.push('');

        for (const item of priorityItems) {
          const suiteLabel = item.suitePath.length > 0 ? `${item.suitePath.join(' › ')} › ` : '';
          const variantLabel = item.variants.map((variant) => `${variant.sourceFile}:${variant.sourceLine}`).join(', ');
          lines.push(`- [ ] ${suiteLabel}${item.title} (${item.variants.length} variants)`);
          lines.push(`  - Flags: fixture=${item.needsFixture ? 'yes' : 'no'}, manual=${item.needsManualAssertion ? 'yes' : 'no'}`);
          lines.push(`  - Sources: ${variantLabel}`);
          lines.push(`  - Tags: ${item.tags.join(', ') || 'none'}`);
          lines.push(`  - Notes: ${item.reasons.join(' ')}`);
        }

        lines.push('');
      }
    }

    fs.writeFileSync(path.join(boardDir, `${groupName}.todo.md`), `${lines.join('\n')}\n`, 'utf8');
  }
}

function buildTodoTitle(item: QueueItem): string {
  const suiteLabel = item.suitePath.length > 0 ? `${item.suitePath.join(' › ')} › ` : '';
  const flagParts = [
    item.priority,
    item.solidStatus,
    `fixture=${item.needsFixture ? 'yes' : 'no'}`,
    `manual=${item.needsManualAssertion ? 'yes' : 'no'}`,
  ];

  return `[${flagParts.join('][')}] ${suiteLabel}${item.title} (${item.variants.length} variants)`;
}

function writeTodoSuites(queue: QueueItem[]) {
  const todoDir = path.resolve(process.cwd(), 'tests/integration/css/generated-parity');
  fs.rmSync(todoDir, { recursive: true, force: true });
  ensureDir(todoDir);

  const grouped = new Map<string, QueueItem[]>();
  for (const item of queue) {
    const targetBaseName = path.basename(item.suggestedTargetFile, path.extname(item.suggestedTargetFile)).replace(/\.test$/, '');
    const entries = grouped.get(targetBaseName) ?? [];
    entries.push(item);
    grouped.set(targetBaseName, entries);
  }

  const sortItems = (items: QueueItem[]) => [...items].sort((left, right) => {
    const leftKey = [
      ACTIVE_STATUS_ORDER.indexOf(left.solidStatus as SolidStatus).toString().padStart(2, '0'),
      PRIORITY_ORDER.indexOf(left.priority as Priority).toString().padStart(2, '0'),
      normalizeForDedupe(`${left.suitePath.join(' ')} ${left.title}`),
    ].join(':');
    const rightKey = [
      ACTIVE_STATUS_ORDER.indexOf(right.solidStatus as SolidStatus).toString().padStart(2, '0'),
      PRIORITY_ORDER.indexOf(right.priority as Priority).toString().padStart(2, '0'),
      normalizeForDedupe(`${right.suitePath.join(' ')} ${right.title}`),
    ].join(':');
    return leftKey.localeCompare(rightKey);
  });

  for (const [groupName, rawItems] of [...grouped.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const items = sortItems(rawItems);
    const lines: string[] = [];
    lines.push('/**');
    lines.push(' * Auto-generated Drizzle parity TODO suite.');
    lines.push(' * Generated by scripts/generate-drizzle-parity.ts');
    lines.push(' */');
    lines.push('');
    lines.push("import { describe, test } from 'vitest';");
    lines.push('');
    lines.push(`describe('Drizzle parity TODO - ${groupName}', () => {`);

    for (const status of ACTIVE_STATUS_ORDER) {
      const statusItems = items.filter((item) => item.solidStatus === status);
      if (statusItems.length === 0) {
        continue;
      }

      lines.push(`  describe('${ACTIVE_STATUS_LABELS[status].heading} (${status})', () => {`);
      for (const priority of PRIORITY_ORDER) {
        const priorityItems = statusItems.filter((item) => item.priority === priority);
        if (priorityItems.length === 0) {
          continue;
        }

        lines.push(`    describe('${priority}', () => {`);
        for (const item of priorityItems) {
          lines.push(`      test.todo(${JSON.stringify(buildTodoTitle(item))});`);
        }
        lines.push('    });');
      }
      lines.push('  });');
      lines.push('');
    }

    lines.push('});');
    lines.push('');

    const filePath = path.join(todoDir, `${groupName}.parity.todo.test.ts`);
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  }
}
function main() {

  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = resolveSourceRoot(options.source);
  const files = walkTsFiles(sourceRoot);
  const cases = files.flatMap((filePath) => extractCasesFromFile(sourceRoot, filePath));
  const queueItems = buildQueue(cases);

  const manifestTotalsByStatus: Record<SolidStatus, number> = {
    direct: 0,
    adapted: 0,
    investigate: 0,
    skip: 0,
  };
  const manifestTotalsByPriority: Record<Priority, number> = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0,
  };
  for (const parityCase of cases) {
    bumpRecord(manifestTotalsByStatus, parityCase.solidStatus);
    bumpRecord(manifestTotalsByPriority, parityCase.priority);
  }

  const queueTotalsByStatus: Record<SolidStatus, number> = {
    direct: 0,
    adapted: 0,
    investigate: 0,
    skip: 0,
  };
  const queueTotalsByPriority: Record<Priority, number> = {
    P0: 0,
    P1: 0,
    P2: 0,
    P3: 0,
  };
  for (const item of queueItems) {
    bumpRecord(queueTotalsByStatus, item.solidStatus);
    bumpRecord(queueTotalsByPriority, item.priority);
  }

  const manifest: OutputManifest = {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    totalFiles: files.length,
    totalTests: cases.length,
    totalUniqueCases: queueItems.length,
    totalsByStatus: manifestTotalsByStatus,
    totalsByPriority: manifestTotalsByPriority,
    cases,
  };

  const queue: OutputQueue = {
    generatedAt: manifest.generatedAt,
    sourceRoot,
    totalItems: queueItems.length,
    totalsByStatus: queueTotalsByStatus,
    totalsByPriority: queueTotalsByPriority,
    items: queueItems,
  };

  const outDir = path.resolve(options.outDir);
  ensureDir(outDir);

  const activeQueueItems = queueItems.filter((item) => item.solidStatus !== 'skip' && !isImplementedParityCase(item));

  writeJson(path.join(outDir, 'all-tests.json'), manifest);
  writeJson(path.join(outDir, 'queue.json'), queue);
  fs.writeFileSync(path.join(outDir, 'summary.md'), buildSummary(manifest, queue), 'utf8');
  writeQueueBoards(outDir, activeQueueItems);
  writeTodoSuites(activeQueueItems);

  console.log(`Parsed ${manifest.totalTests} tests from ${manifest.totalFiles} files.`);
  console.log(`Unique queue items: ${queue.totalItems}`);
  console.log(`Output directory: ${outDir}`);
}

if (require.main === module) {
  main();
}
