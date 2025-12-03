import { describe, it, expect, vi } from 'vitest';
import { CompositeDiscovery } from '../../../../src/core/discovery/composite-discovery';
import { DataDiscovery } from '../../../../src/core/discovery/types';

describe('CompositeDiscovery', () => {
  it('should return first successful discovery', async () => {
    const strategy1: DataDiscovery = {
      discover: vi.fn().mockResolvedValue([]),
      register: vi.fn(),
      isRegistered: vi.fn().mockResolvedValue(false)
    };
    const strategy2: DataDiscovery = {
      discover: vi.fn().mockResolvedValue([{ container: 'https://example.com/data', source: 'interop' }]),
      register: vi.fn(),
      isRegistered: vi.fn().mockResolvedValue(true)
    };

    const composite = new CompositeDiscovery([strategy1, strategy2]);
    const result = await composite.discover('https://schema.org/Person');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('interop');
    expect(strategy1.discover).toHaveBeenCalled();
    expect(strategy2.discover).toHaveBeenCalled();
  });

  it('should fallback if first strategy fails', async () => {
    const strategy1: DataDiscovery = {
      discover: vi.fn().mockRejectedValue(new Error('Failed')),
      register: vi.fn(),
      isRegistered: vi.fn()
    };
    const strategy2: DataDiscovery = {
      discover: vi.fn().mockResolvedValue([{ container: 'https://example.com/data', source: 'typeindex' }]),
      register: vi.fn(),
      isRegistered: vi.fn()
    };

    const composite = new CompositeDiscovery([strategy1, strategy2]);
    const result = await composite.discover('https://schema.org/Person');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('typeindex');
  });
});
