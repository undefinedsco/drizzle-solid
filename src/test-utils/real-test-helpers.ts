import { describe } from '@jest/globals';

export const ENABLE_REAL_TESTS = process.env.SOLID_ENABLE_REAL_TESTS !== 'false';

export const describeIfReal = ENABLE_REAL_TESTS ? describe : describe.skip;

const warnedSuites = new Set<string>();

export function warnIfRealTestsSkipped(label: string): void {
  if (ENABLE_REAL_TESTS) return;
  if (warnedSuites.has(label)) return;
  warnedSuites.add(label);
  // eslint-disable-next-line no-console
  console.warn(`[${label}] skipping Solid real-pod tests: set SOLID_ENABLE_REAL_TESTS=true to enable`);
}
