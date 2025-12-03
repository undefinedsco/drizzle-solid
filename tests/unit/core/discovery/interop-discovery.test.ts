import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteropDiscovery } from '../../../../src/core/discovery/interop-discovery';
import { INTEROP } from '../../../../src/core/discovery/interop-types';
import * as solidClient from '@inrupt/solid-client';

vi.mock('@inrupt/solid-client');

describe('InteropDiscovery', () => {
  let discovery: InteropDiscovery;
  const mockFetch = vi.fn();
  const webId = 'https://alice.example/profile/card#me';

  beforeEach(() => {
    vi.resetAllMocks();
    discovery = new InteropDiscovery(webId, mockFetch);
  });

  it('should return empty list if profile has no registry set', async () => {
    // Mock Profile
    const profileDataset = {} as any;
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce(profileDataset);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any); // Profile Thing
    vi.mocked(solidClient.getUrl).mockReturnValueOnce(null); // No hasRegistrySet

    const result = await discovery.discover('https://schema.org/Person');
    expect(result).toEqual([]);
  });

  it('should return empty list if registry set is empty', async () => {
    // Mock Profile
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrl).mockReturnValueOnce('https://alice.example/registrySet');

    // Mock RegistrySet
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce([]); // No DataRegistry

    const result = await discovery.discover('https://schema.org/Person');
    expect(result).toEqual([]);
  });

  // Simplified test for full flow
  it('should find location if shape tree matches', async () => {
    const registrySetUrl = 'https://alice.example/registrySet';
    const dataRegistryUrl = 'https://alice.example/data/registry';
    const registrationUrl = 'https://alice.example/data/registration1';
    const shapeTreeUrl = 'https://shapes.example/PersonTree';
    const targetClass = 'https://schema.org/Person';

    // 1. Profile -> RegistrySet
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrl).mockReturnValueOnce(registrySetUrl);

    // 2. RegistrySet -> DataRegistry
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce([dataRegistryUrl]);

    // 3. DataRegistry -> DataRegistration
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce([registrationUrl]);

    // 4. DataRegistration -> ShapeTree
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrl).mockReturnValueOnce(shapeTreeUrl); // registeredShapeTree

    // 5. ShapeTree -> expectsType
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrl).mockReturnValueOnce(targetClass); // expectsType

    const result = await discovery.discover(targetClass);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      container: registrationUrl,
      source: 'interop',
      shape: shapeTreeUrl
    });
  });
});
