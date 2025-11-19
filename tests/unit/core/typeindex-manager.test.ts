import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { TypeIndexManager, type TypeIndexEntry } from '@src/core/typeindex-manager';

// Mock @inrupt/solid-client at module level
vi.mock('@inrupt/solid-client', async () => {
  const actual = await vi.importActual<typeof import('@inrupt/solid-client')>('@inrupt/solid-client');
  return {
    ...actual,
    getSolidDataset: vi.fn(),
    getThing: vi.fn(),
    getUrl: vi.fn(),
    getThingAll: vi.fn(),
    saveSolidDatasetAt: vi.fn(),
  };
});

describe('TypeIndexManager', () => {
  const originalWebId = 'https://alice.example/profile#me';
  const overrideWebId = 'https://bob.example/profile#me';
  const podUrl = 'https://alice.example/';
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('restores original webId after autoDiscoverAndRegister with override', async () => {
    const manager = new TypeIndexManager(originalWebId, podUrl);
    const mockEntries: TypeIndexEntry[] = [
      {
        rdfClass: 'https://schema.org/Person',
        containerPath: '/profiles/',
        forClass: 'Person'
      }
    ];

    const findTypeIndex = vi
      .spyOn(manager, 'findTypeIndex')
      .mockResolvedValue('https://bob.example/settings/typeIndex.ttl');
    const discoverTypes = vi
      .spyOn(manager, 'discoverTypes')
      .mockResolvedValue(mockEntries);

    const results = await manager.autoDiscoverAndRegister(overrideWebId);

    expect(results).toEqual(mockEntries);
    expect(findTypeIndex).toHaveBeenCalledTimes(1);
    expect(discoverTypes).toHaveBeenCalledWith('https://bob.example/settings/typeIndex.ttl');
    expect(manager.getConfig().webId).toBe(originalWebId);
  });

  it('restores original webId when discovery fails', async () => {
    const manager = new TypeIndexManager(originalWebId, podUrl);

    vi.spyOn(manager, 'findTypeIndex').mockRejectedValue(new Error('network error'));

    const results = await manager.autoDiscoverAndRegister(overrideWebId);

    expect(results).toEqual([]);
    expect(manager.getConfig().webId).toBe(originalWebId);
  });

  describe('findTypeIndex with skipProfile scenario', () => {
    it('should find TypeIndex even when profile is not loaded (skipProfile)', async () => {
      const { getSolidDataset, getThing, getUrl } = await import('@inrupt/solid-client');
      const manager = new TypeIndexManager(originalWebId, podUrl);

      // Mock getSolidDataset to simulate profile data being available
      const mockProfileDataset = {
        type: 'Dataset',
        graphs: { default: {} }
      };

      const mockProfileThing = {
        type: 'Subject',
        url: originalWebId,
        predicates: {
          'http://www.w3.org/ns/solid/terms#privateTypeIndex': {
            namedNodes: ['https://alice.example/settings/privateTypeIndex.ttl']
          }
        }
      };

      vi.mocked(getSolidDataset).mockResolvedValue(mockProfileDataset as any);
      vi.mocked(getThing).mockReturnValue(mockProfileThing as any);
      vi.mocked(getUrl).mockReturnValue('https://alice.example/settings/privateTypeIndex.ttl');

      const result = await manager.findTypeIndex();

      expect(result).toBe('https://alice.example/settings/privateTypeIndex.ttl');
      expect(getSolidDataset).toHaveBeenCalledWith(
        originalWebId,
        expect.objectContaining({ fetch: expect.any(Function) })
      );
    });

    it('should fallback to standard locations when profile fetch fails completely', async () => {
      const { getSolidDataset } = await import('@inrupt/solid-client');
      const manager = new TypeIndexManager(originalWebId, podUrl);

      // Mock profile fetch to fail (simulating skipProfile scenario)
      vi.mocked(getSolidDataset)
        .mockRejectedValueOnce(new Error('Profile not loaded'))
        // But succeed when checking standard locations
        .mockResolvedValueOnce({ type: 'Dataset', graphs: { default: {} } } as any);

      const result = await manager.findTypeIndex();

      expect(result).toBe('https://alice.example/settings/privateTypeIndex.ttl');
      // Should have tried profile first, then standard location
      expect(getSolidDataset).toHaveBeenCalledTimes(2);
    });

    it('should handle empty profile dataset by trying all things', async () => {
      const { getSolidDataset, getThing, getUrl, getThingAll } = await import('@inrupt/solid-client');
      const manager = new TypeIndexManager(originalWebId, podUrl);

      const mockProfileDataset = {
        type: 'Dataset',
        graphs: { default: {} }
      };

      const mockThing = {
        type: 'Subject',
        url: 'https://alice.example/profile/card',
        predicates: {
          'http://www.w3.org/ns/solid/terms#publicTypeIndex': {
            namedNodes: ['https://alice.example/settings/publicTypeIndex.ttl']
          }
        }
      };

      vi.mocked(getSolidDataset).mockResolvedValue(mockProfileDataset as any);
      // getThing returns null for exact webId match
      vi.mocked(getThing).mockReturnValue(null);
      // But getThingAll returns alternative things
      vi.mocked(getThingAll).mockReturnValue([mockThing] as any);
      vi.mocked(getUrl).mockReturnValue('https://alice.example/settings/publicTypeIndex.ttl');

      const result = await manager.findTypeIndex();

      expect(result).toBe('https://alice.example/settings/publicTypeIndex.ttl');
      expect(getThingAll).toHaveBeenCalledWith(mockProfileDataset);
    });

    it('should try both private and public TypeIndex predicates', async () => {
      const { getSolidDataset, getThing, getUrl } = await import('@inrupt/solid-client');
      const manager = new TypeIndexManager(originalWebId, podUrl);

      const mockProfileDataset = { type: 'Dataset', graphs: { default: {} } };
      const mockProfileThing = {
        type: 'Subject',
        url: originalWebId,
        predicates: {}
      };

      vi.mocked(getSolidDataset).mockResolvedValue(mockProfileDataset as any);
      vi.mocked(getThing).mockReturnValue(mockProfileThing as any);

      // First call for privateTypeIndex returns null
      // Second call for publicTypeIndex returns the URL
      vi.mocked(getUrl)
        .mockReturnValueOnce(null) // privateTypeIndex
        .mockReturnValueOnce('https://alice.example/settings/publicTypeIndex.ttl'); // publicTypeIndex

      const result = await manager.findTypeIndex();

      expect(result).toBe('https://alice.example/settings/publicTypeIndex.ttl');
      expect(getUrl).toHaveBeenCalledWith(
        mockProfileThing,
        'http://www.w3.org/ns/solid/terms#privateTypeIndex'
      );
      expect(getUrl).toHaveBeenCalledWith(
        mockProfileThing,
        'http://www.w3.org/ns/solid/terms#publicTypeIndex'
      );
    });

    it('should return null when no TypeIndex is found anywhere', async () => {
      const { getSolidDataset } = await import('@inrupt/solid-client');
      const manager = new TypeIndexManager(originalWebId, podUrl);

      // Profile fetch fails
      vi.mocked(getSolidDataset)
        .mockRejectedValueOnce(new Error('Profile not loaded'))
        // All standard locations also fail
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Not found'))
        .mockRejectedValueOnce(new Error('Not found'));

      const result = await manager.findTypeIndex();

      expect(result).toBeNull();
      // Should have tried profile + 3 standard locations
      expect(getSolidDataset).toHaveBeenCalledTimes(4);
    });
  });

  describe('registerType with public/private visibility', () => {
    it('should register to private TypeIndex by default', async () => {
      const { getSolidDataset, getThing, getUrl, saveSolidDatasetAt } = await import('@inrupt/solid-client');
      const manager = new TypeIndexManager(originalWebId, podUrl);

      const mockProfileDataset = { type: 'Dataset', graphs: { default: {} } };
      const mockProfileThing = { type: 'Subject', url: originalWebId };

      vi.mocked(getSolidDataset).mockResolvedValue(mockProfileDataset as any);
      vi.mocked(getThing).mockReturnValue(mockProfileThing as any);
      vi.mocked(getUrl).mockReturnValue('https://alice.example/settings/privateTypeIndex.ttl');
      vi.mocked(saveSolidDatasetAt).mockResolvedValue(mockProfileDataset as any);

      const entry: TypeIndexEntry = {
        rdfClass: 'https://schema.org/Person',
        containerPath: '/people/',
        forClass: 'Person'
      };

      await manager.registerType(entry);

      // 应该查找 privateTypeIndex
      expect(getUrl).toHaveBeenCalledWith(
        mockProfileThing,
        'http://www.w3.org/ns/solid/terms#privateTypeIndex'
      );
      expect(saveSolidDatasetAt).toHaveBeenCalledWith(
        'https://alice.example/settings/privateTypeIndex.ttl',
        expect.anything(),
        expect.objectContaining({ fetch: expect.any(Function) })
      );
    });

    it('should register to public TypeIndex when visibility=public', async () => {
      const { getSolidDataset, getThing, getUrl, saveSolidDatasetAt } = await import('@inrupt/solid-client');
      const manager = new TypeIndexManager(originalWebId, podUrl);

      const mockProfileDataset = { type: 'Dataset', graphs: { default: {} } };
      const mockProfileThing = { type: 'Subject', url: originalWebId };

      vi.mocked(getSolidDataset).mockResolvedValue(mockProfileDataset as any);
      vi.mocked(getThing).mockReturnValue(mockProfileThing as any);
      vi.mocked(getUrl).mockReturnValue('https://alice.example/settings/publicTypeIndex.ttl');
      vi.mocked(saveSolidDatasetAt).mockResolvedValue(mockProfileDataset as any);

      const entry: TypeIndexEntry = {
        rdfClass: 'https://schema.org/BlogPosting',
        containerPath: '/posts/',
        forClass: 'BlogPost',
        visibility: 'public'
      };

      await manager.registerType(entry);

      // 应该查找 publicTypeIndex
      expect(getUrl).toHaveBeenCalledWith(
        mockProfileThing,
        'http://www.w3.org/ns/solid/terms#publicTypeIndex'
      );
      expect(saveSolidDatasetAt).toHaveBeenCalledWith(
        'https://alice.example/settings/publicTypeIndex.ttl',
        expect.anything(),
        expect.objectContaining({ fetch: expect.any(Function) })
      );
    });

    it('should fallback to standard location when profile does not have TypeIndex', async () => {
      const { getSolidDataset, getThing, getUrl, saveSolidDatasetAt } = await import('@inrupt/solid-client');
      const manager = new TypeIndexManager(originalWebId, podUrl);

      const mockProfileDataset = { type: 'Dataset', graphs: { default: {} } };
      const mockProfileThing = { type: 'Subject', url: originalWebId };

      // First call: fetch profile
      // Second call: check standard location (succeeds)
      // Third call: save to standard location
      vi.mocked(getSolidDataset)
        .mockResolvedValueOnce(mockProfileDataset as any)
        .mockResolvedValueOnce(mockProfileDataset as any)
        .mockResolvedValueOnce(mockProfileDataset as any);

      vi.mocked(getThing).mockReturnValue(mockProfileThing as any);
      vi.mocked(getUrl).mockReturnValue(null); // profile 中没有 TypeIndex 链接
      vi.mocked(saveSolidDatasetAt).mockResolvedValue(mockProfileDataset as any);

      const entry: TypeIndexEntry = {
        rdfClass: 'https://schema.org/Event',
        containerPath: '/events/',
        forClass: 'Event',
        visibility: 'private'
      };

      await manager.registerType(entry);

      // 应该保存到标准位置
      expect(saveSolidDatasetAt).toHaveBeenCalledWith(
        'https://alice.example/settings/privateTypeIndex.ttl',
        expect.anything(),
        expect.objectContaining({ fetch: expect.any(Function) })
      );
    });
  });
});
