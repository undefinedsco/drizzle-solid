import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { TypeIndexManager, type TypeIndexEntry } from '@src/core/typeindex-manager';

describe('TypeIndexManager', () => {
  const originalWebId = 'https://alice.example/profile#me';
  const overrideWebId = 'https://bob.example/profile#me';
  const podUrl = 'https://alice.example/';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
});
