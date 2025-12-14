import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteropDiscovery } from '../../../../src/core/discovery/interop-discovery';
import { INTEROP } from '../../../../src/core/discovery/interop-types';
import * as solidClient from '@inrupt/solid-client';

vi.mock('@inrupt/solid-client');

describe('InteropDiscovery', () => {
  let discovery: InteropDiscovery;
  const mockFetch = vi.fn();
  const webId = 'https://alice.example/profile/card#me';
  const clientId = 'https://app.example/id';

  beforeEach(() => {
    vi.resetAllMocks();
    discovery = new InteropDiscovery(webId, mockFetch, clientId);
  });

  it('should return empty list if profile has no registry set', async () => {
    // Mock Profile
    const profileDataset = {} as any;
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce(profileDataset);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any); // Profile Thing
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce([]); // No hasRegistrySet

    const result = await discovery.discover('https://schema.org/Person');
    expect(result).toEqual([]);
  });

  it('should return empty list if registry set is empty', async () => {
    // Mock Profile
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce(['https://alice.example/registrySet']);

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
    const shapeUrl = 'https://shapes.example/Person.shacl';
    const targetClass = 'https://schema.org/Person';
    const registeredBy = 'https://app.example/id';

    // 1. Profile -> RegistrySet
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce([registrySetUrl]);

    // 2. RegistrySet -> DataRegistry (discoverDataRegistrations)
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce([dataRegistryUrl]); // hasDataRegistry

    // 3. DataRegistry -> DataRegistration
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce([registrationUrl]); // hasDataRegistration

    // 4. DataRegistration -> ShapeTree + registeredBy
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrl)
      .mockReturnValueOnce(shapeTreeUrl)    // registeredShapeTree
      .mockReturnValueOnce(registeredBy);   // registeredBy

    // 5. ShapeTree -> expectsType + shape (resolveShapeTree)
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrl)
      .mockReturnValueOnce(targetClass)     // expectsType
      .mockReturnValueOnce(shapeUrl);       // shape

    // 6. discoverAccessGrants needs RegistrySet again for AgentRegistry
    vi.mocked(solidClient.getSolidDataset).mockResolvedValueOnce({} as any);
    vi.mocked(solidClient.getThing).mockReturnValueOnce({} as any);
    vi.mocked(solidClient.getUrlAll).mockReturnValueOnce([]); // hasAgentRegistry - empty

    const result = await discovery.discover(targetClass);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      container: registrationUrl,
      source: 'interop',
      shapes: [{
        url: shapeUrl,
        shapeTree: shapeTreeUrl,
        registeredBy: registeredBy,
        source: 'interop'
      }]
    });
  });
});
