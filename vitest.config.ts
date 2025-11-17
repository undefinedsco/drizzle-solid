import { defineConfig } from 'vitest/config';
import path from 'path';

const shouldForceSerial = process.env.SOLID_SERIAL_TESTS === 'true';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    teardownTimeout: 10000,
    testTimeout: 120000,
    // 仅在 SOLID_SERIAL_TESTS=true 时强制单线程，默认恢复 Vitest 并发
    ...(shouldForceSerial
      ? {
          pool: 'threads' as const,
          poolOptions: {
            threads: {
              minThreads: 1,
              maxThreads: 1
            }
          }
        }
      : {}),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
    include: [
      'tests/**/*.test.ts'
    ],
    exclude: [
      'node_modules',
      'dist',
      '.git'
    ]
  },
  resolve: {
    alias: {
      '@src': path.resolve(__dirname, './src'),
    },
  },
});
