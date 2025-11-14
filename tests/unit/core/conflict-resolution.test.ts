import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictResolver,
  createConflictResolver,
  saveWithConflictResolution,
  type ConflictResolutionConfig
} from '../../../src/core/conflict-resolution';
import type { SolidDataset, Thing } from '@inrupt/solid-client';

// Mock @inrupt/solid-client
vi.mock('@inrupt/solid-client', async () => {
  const actual = await vi.importActual('@inrupt/solid-client');
  return {
    ...actual,
    getSolidDataset: vi.fn(),
    saveSolidDatasetAt: vi.fn(),
    getThing: vi.fn(),
    setThing: vi.fn(),
    getStringNoLocale: vi.fn(),
    getInteger: vi.fn(),
    getBoolean: vi.fn(),
    getDatetime: vi.fn(),
    getUrl: vi.fn()
  };
});

describe('ConflictResolver', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockGetSolidDataset: any;
  let mockSaveSolidDatasetAt: any;
  let mockGetThing: any;
  let mockSetThing: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch = vi.fn();

    const solidClient = await import('@inrupt/solid-client');
    mockGetSolidDataset = vi.mocked(solidClient.getSolidDataset);
    mockSaveSolidDatasetAt = vi.mocked(solidClient.saveSolidDatasetAt);
    mockGetThing = vi.mocked(solidClient.getThing);
    mockSetThing = vi.mocked(solidClient.setThing);
  });

  describe('saveWithRetry', () => {
    it('should save successfully on first attempt', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;
      const modifiedDataset = { type: 'Dataset', graphs: { default: { modified: true } } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockSaveSolidDatasetAt.mockResolvedValue(modifiedDataset);

      const resolver = new ConflictResolver(mockFetch);
      const modifier = vi.fn().mockReturnValue(modifiedDataset);

      const result = await resolver.saveWithRetry('https://pod.example/resource.ttl', modifier);

      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
      expect(mockGetSolidDataset).toHaveBeenCalledTimes(1);
      expect(mockSaveSolidDatasetAt).toHaveBeenCalledTimes(1);
      expect(modifier).toHaveBeenCalledWith(mockDataset);
    });

    it('should retry on 412 Precondition Failed and succeed', async () => {
      const dataset1 = { type: 'Dataset', graphs: { default: { version: 1 } } } as unknown as SolidDataset;
      const dataset2 = { type: 'Dataset', graphs: { default: { version: 2 } } } as unknown as SolidDataset;
      const modified2 = { type: 'Dataset', graphs: { default: { version: 2, modified: true } } } as unknown as SolidDataset;

      // First attempt: get dataset1, then fail with 412
      mockGetSolidDataset
        .mockResolvedValueOnce(dataset1)
        .mockResolvedValueOnce(dataset2);

      mockSaveSolidDatasetAt
        .mockRejectedValueOnce({ statusCode: 412, message: 'Precondition Failed' })
        .mockResolvedValueOnce(modified2);

      const resolver = new ConflictResolver(mockFetch, { logging: false });
      const modifier = vi.fn()
        .mockReturnValueOnce({ type: 'Dataset', graphs: { default: { version: 1, modified: true } } })
        .mockReturnValueOnce(modified2);

      const result = await resolver.saveWithRetry('https://pod.example/resource.ttl', modifier);

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);
      expect(mockGetSolidDataset).toHaveBeenCalledTimes(2);
      expect(mockSaveSolidDatasetAt).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries exceeded', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockSaveSolidDatasetAt.mockRejectedValue({ statusCode: 412, message: 'Precondition Failed' });

      const resolver = new ConflictResolver(mockFetch, { maxRetries: 2, retryDelay: 0 });
      const modifier = vi.fn().mockReturnValue(mockDataset);

      const result = await resolver.saveWithRetry('https://pod.example/resource.ttl', modifier);

      expect(result.success).toBe(false);
      expect(result.retries).toBe(2);
      expect(result.error).toBeDefined();
      expect(mockGetSolidDataset).toHaveBeenCalledTimes(3); // initial + 2 retries
      expect(mockSaveSolidDatasetAt).toHaveBeenCalledTimes(3);
    });

    it('should not retry on other errors (not 412)', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockSaveSolidDatasetAt.mockRejectedValue({ statusCode: 500, message: 'Internal Server Error' });

      const resolver = new ConflictResolver(mockFetch);
      const modifier = vi.fn().mockReturnValue(mockDataset);

      const result = await resolver.saveWithRetry('https://pod.example/resource.ttl', modifier);

      expect(result.success).toBe(false);
      expect(result.retries).toBe(0);
      expect(result.error).toContain('Internal Server Error');
      expect(mockGetSolidDataset).toHaveBeenCalledTimes(1);
      expect(mockSaveSolidDatasetAt).toHaveBeenCalledTimes(1);
    });

    it('should support async modifier functions', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;
      const modifiedDataset = { type: 'Dataset', graphs: { default: { modified: true } } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockSaveSolidDatasetAt.mockResolvedValue(modifiedDataset);

      const resolver = new ConflictResolver(mockFetch);
      const asyncModifier = async (dataset: SolidDataset) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return modifiedDataset;
      };

      const result = await resolver.saveWithRetry('https://pod.example/resource.ttl', asyncModifier);

      expect(result.success).toBe(true);
      expect(result.retries).toBe(0);
    });
  });

  describe('saveThingWithMerge', () => {
    it('should create Thing if it does not exist', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;
      const localThing = { url: 'https://pod.example/resource#thing' } as Thing;
      const updatedDataset = { type: 'Dataset', graphs: { default: { thing: true } } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockGetThing.mockReturnValue(null); // Thing doesn't exist
      mockSetThing.mockReturnValue(updatedDataset);
      mockSaveSolidDatasetAt.mockResolvedValue(updatedDataset);

      const resolver = new ConflictResolver(mockFetch, { strategy: 'field-level-merge' });

      const result = await resolver.saveThingWithMerge(
        'https://pod.example/resource.ttl',
        'https://pod.example/resource#thing',
        localThing,
        ['https://schema.org/name']
      );

      expect(result.success).toBe(true);
      expect(mockGetThing).toHaveBeenCalledWith(mockDataset, 'https://pod.example/resource#thing');
      expect(mockSetThing).toHaveBeenCalledWith(mockDataset, localThing);
    });

    it('should merge Thing with last-write-wins strategy', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;
      const localThing = { url: 'https://pod.example/resource#thing', predicates: { local: 'value' } } as unknown as Thing;
      const remoteThing = { url: 'https://pod.example/resource#thing', predicates: { remote: 'value' } } as unknown as Thing;
      const updatedDataset = { type: 'Dataset', graphs: { default: { thing: true } } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockGetThing.mockReturnValue(remoteThing);
      mockSetThing.mockReturnValue(updatedDataset);
      mockSaveSolidDatasetAt.mockResolvedValue(updatedDataset);

      const resolver = new ConflictResolver(mockFetch, { strategy: 'last-write-wins' });

      const result = await resolver.saveThingWithMerge(
        'https://pod.example/resource.ttl',
        'https://pod.example/resource#thing',
        localThing,
        ['https://schema.org/name']
      );

      expect(result.success).toBe(true);
      // With last-write-wins, local version should be used
      expect(mockSetThing).toHaveBeenCalledWith(mockDataset, localThing);
    });

    it('should handle field-level merge strategy', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;
      const localThing = { url: 'https://pod.example/resource#thing' } as unknown as Thing;
      const remoteThing = { url: 'https://pod.example/resource#thing' } as unknown as Thing;
      const updatedDataset = { type: 'Dataset', graphs: { default: { thing: true } } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockGetThing.mockReturnValue(remoteThing);
      mockSetThing.mockReturnValue(updatedDataset);
      mockSaveSolidDatasetAt.mockResolvedValue(updatedDataset);

      const resolver = new ConflictResolver(mockFetch, { strategy: 'field-level-merge' });

      const result = await resolver.saveThingWithMerge(
        'https://pod.example/resource.ttl',
        'https://pod.example/resource#thing',
        localThing,
        ['https://schema.org/name', 'https://schema.org/description']
      );

      expect(result.success).toBe(true);
      expect(mockGetThing).toHaveBeenCalled();
    });
  });

  describe('createConflictResolver', () => {
    it('should create resolver with default config', () => {
      const resolver = createConflictResolver(mockFetch);
      expect(resolver).toBeInstanceOf(ConflictResolver);
    });

    it('should create resolver with custom config', () => {
      const config: ConflictResolutionConfig = {
        maxRetries: 5,
        strategy: 'field-level-merge',
        logging: true
      };

      const resolver = createConflictResolver(mockFetch, config);
      expect(resolver).toBeInstanceOf(ConflictResolver);
    });
  });

  describe('saveWithConflictResolution', () => {
    it('should execute save with retry using convenience function', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;
      const modifiedDataset = { type: 'Dataset', graphs: { default: { modified: true } } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockSaveSolidDatasetAt.mockResolvedValue(modifiedDataset);

      const modifier = vi.fn().mockReturnValue(modifiedDataset);

      const result = await saveWithConflictResolution(
        mockFetch,
        'https://pod.example/resource.ttl',
        modifier,
        { strategy: 'last-write-wins' }
      );

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('last-write-wins');
      expect(modifier).toHaveBeenCalledWith(mockDataset);
    });
  });

  describe('merge strategies', () => {
    it('should use custom resolver with user-resolution strategy', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;
      const localThing = { url: 'https://pod.example/resource#thing', predicates: { local: 'value' } } as unknown as Thing;
      const remoteThing = { url: 'https://pod.example/resource#thing', predicates: { remote: 'value' } } as unknown as Thing;
      const mergedThing = { url: 'https://pod.example/resource#thing', predicates: { merged: 'value' } } as unknown as Thing;
      const updatedDataset = { type: 'Dataset', graphs: { default: { thing: true } } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockGetThing.mockReturnValue(remoteThing);
      mockSetThing.mockReturnValue(updatedDataset);
      mockSaveSolidDatasetAt.mockResolvedValue(updatedDataset);

      const customResolver = vi.fn().mockReturnValue(mergedThing);

      const resolver = new ConflictResolver(mockFetch, {
        strategy: 'user-resolution',
        resolver: customResolver
      });

      const result = await resolver.saveThingWithMerge(
        'https://pod.example/resource.ttl',
        'https://pod.example/resource#thing',
        localThing,
        ['https://schema.org/name']
      );

      expect(result.success).toBe(true);
      expect(customResolver).toHaveBeenCalledWith(
        localThing,
        remoteThing,
        ['https://schema.org/name']
      );
      expect(mockSetThing).toHaveBeenCalledWith(mockDataset, mergedThing);
    });

    it('should handle timestamp-based merge when timestamps are available', async () => {
      const { getDatetime } = await import('@inrupt/solid-client');
      const mockGetDatetime = vi.mocked(getDatetime);

      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;
      const localThing = { url: 'https://pod.example/resource#thing' } as unknown as Thing;
      const remoteThing = { url: 'https://pod.example/resource#thing' } as unknown as Thing;
      const updatedDataset = { type: 'Dataset', graphs: { default: { thing: true } } } as unknown as SolidDataset;

      const localDate = new Date('2025-01-15T10:00:00Z');
      const remoteDate = new Date('2025-01-15T09:00:00Z');

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockGetThing.mockReturnValue(remoteThing);
      mockSetThing.mockReturnValue(updatedDataset);
      mockSaveSolidDatasetAt.mockResolvedValue(updatedDataset);

      // Mock timestamp retrieval - local is newer
      mockGetDatetime
        .mockReturnValueOnce(localDate)  // first call for local
        .mockReturnValueOnce(remoteDate); // second call for remote

      const resolver = new ConflictResolver(mockFetch, { strategy: 'timestamp-based' });

      const result = await resolver.saveThingWithMerge(
        'https://pod.example/resource.ttl',
        'https://pod.example/resource#thing',
        localThing,
        ['https://schema.org/name']
      );

      expect(result.success).toBe(true);
      // Since local timestamp is newer, local version should be used
      expect(mockSetThing).toHaveBeenCalledWith(mockDataset, localThing);
    });
  });

  describe('retry delay', () => {
    it('should respect retry delay configuration', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockSaveSolidDatasetAt
        .mockRejectedValueOnce({ statusCode: 412 })
        .mockResolvedValueOnce(mockDataset);

      const resolver = new ConflictResolver(mockFetch, { retryDelay: 50 });
      const modifier = vi.fn().mockReturnValue(mockDataset);

      const startTime = Date.now();
      const result = await resolver.saveWithRetry('https://pod.example/resource.ttl', modifier);
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);
      expect(elapsed).toBeGreaterThanOrEqual(50); // At least one retry delay
    }, 10000);

    it('should allow zero retry delay for immediate retry', async () => {
      const mockDataset = { type: 'Dataset', graphs: { default: {} } } as unknown as SolidDataset;

      mockGetSolidDataset.mockResolvedValue(mockDataset);
      mockSaveSolidDatasetAt
        .mockRejectedValueOnce({ statusCode: 412 })
        .mockResolvedValueOnce(mockDataset);

      const resolver = new ConflictResolver(mockFetch, { retryDelay: 0 });
      const modifier = vi.fn().mockReturnValue(mockDataset);

      const startTime = Date.now();
      const result = await resolver.saveWithRetry('https://pod.example/resource.ttl', modifier);
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);
      expect(elapsed).toBeLessThan(100); // Should be very fast with no delay
    });
  });
});
