/**
 * TypeIndexDiscovery Unit Tests
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TypeIndexDiscovery } from '../../../../src/core/discovery';
import { TypeIndexManager } from '../../../../src/core/typeindex-manager';
import { podTable, string, id } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';

// Mock TypeIndexManager class (not the instance)
vi.mock('../../../../src/core/typeindex-manager');

// 测试用命名空间
const ns = { prefix: 'schema', uri: 'https://schema.org/' };

describe('TypeIndexDiscovery', () => {
  let discovery: TypeIndexDiscovery;
  let mockManager: any;
  let resolver: UriResolverImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a mock instance with methods we need
    mockManager = {
      discoverSpecificType: vi.fn(),
      registerType: vi.fn(),
      discoverSpecificTypes: vi.fn(),
      createTypeIndex: vi.fn(),
    };

    resolver = new UriResolverImpl('https://pod.example');
    discovery = new TypeIndexDiscovery(
      mockManager,
      'https://pod.example',
      resolver
    );
  });

  describe('register', () => {
    it('should register table type to TypeIndex', async () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
        typeIndex: 'private',
      });

      // Mock discoverSpecificType to return null (not registered)
      mockManager.discoverSpecificType.mockResolvedValue(null);

      await discovery.register(table);

      expect(mockManager.registerType).toHaveBeenCalledWith(expect.objectContaining({
        forClass: 'users',
        rdfClass: 'https://schema.org/Person',
        visibility: 'private'
      }));
    });

    it('should skip registration when typeIndex is not set', async () => {
      const table = podTable('tags', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/tags.ttl',
        type: 'https://schema.org/Tag',
        namespace: ns,
        // 没有设置 typeIndex
      });

      await discovery.register(table);

      expect(mockManager.registerType).not.toHaveBeenCalled();
    });

    it('should register (update) even if already registered, to ensure path consistency', async () => {
      // Changed behavior: we now always register/update to ensure consistency
      // But let's check if it calls registerType
      
      const table = podTable('users', {
        id: id(),
        name: string('name').predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
        typeIndex: 'private',
      });

      mockManager.discoverSpecificType.mockResolvedValue({
        instanceContainer: 'https://pod.example/data/users/'
      });

      await discovery.register(table);

      expect(mockManager.registerType).toHaveBeenCalled();
    });
  });

  describe('discover', () => {
    it('should discover types from TypeIndex', async () => {
      mockManager.discoverSpecificTypes.mockResolvedValue([
        {
          rdfClass: 'https://schema.org/Person',
          containerPath: '/data/users/',
          forClass: 'users',
          instanceContainer: 'https://pod.example/data/users/',
          visibility: 'private',
        },
      ]);

      const locations = await discovery.discover('https://schema.org/Person');

      expect(locations).toHaveLength(1);
      expect(locations[0]).toEqual({
        container: 'https://pod.example/data/users/',
        shapes: [],
        source: 'typeindex',
      });
    });

    it('should return empty array when no matches', async () => {
      mockManager.discoverSpecificTypes.mockResolvedValue([]);

      const locations = await discovery.discover('https://schema.org/Person');

      expect(locations).toHaveLength(0);
    });
  });

  describe('isRegistered', () => {
    it('should check if type is registered', async () => {
      mockManager.discoverSpecificType.mockResolvedValue({
        instanceContainer: '...'
      });

      const result = await discovery.isRegistered('https://schema.org/Person');

      expect(result).toBe(true);
      expect(mockManager.discoverSpecificType).toHaveBeenCalledWith('https://schema.org/Person');
    });

    it('should return false if type not registered', async () => {
      mockManager.discoverSpecificType.mockResolvedValue(null);

      const result = await discovery.isRegistered('https://schema.org/Person');

      expect(result).toBe(false);
    });
  });
});
