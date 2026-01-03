import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileManager } from '../../../src/core/profile-manager';
import type { SolidSession } from '../../../src/core/schema';

// Mock @inrupt/solid-client
vi.mock('@inrupt/solid-client', () => ({
  getSolidDataset: vi.fn(),
  saveSolidDatasetAt: vi.fn(),
  getThing: vi.fn(),
  setThing: vi.fn(),
  addUrl: vi.fn(),
  removeUrl: vi.fn(),
  getUrlAll: vi.fn(),
  createThing: vi.fn(),
}));

import {
  getSolidDataset,
  saveSolidDatasetAt,
  getThing,
  setThing,
  addUrl,
  removeUrl,
  getUrlAll,
  createThing,
} from '@inrupt/solid-client';

describe('ProfileManager', () => {
  const mockFetch = vi.fn();
  const webId = 'https://alice.pod/profile/card#me';
  
  const mockSession: SolidSession = {
    info: {
      isLoggedIn: true,
      webId,
    },
    fetch: mockFetch as unknown as typeof fetch,
  };
  
  let profileManager: ProfileManager;

  beforeEach(() => {
    vi.clearAllMocks();
    profileManager = new ProfileManager(mockSession);
  });

  describe('constructor', () => {
    it('should create ProfileManager from SolidSession', () => {
      const pm = new ProfileManager(mockSession);
      expect(pm).toBeInstanceOf(ProfileManager);
      expect(pm.getWebId()).toBe(webId);
    });

    it('should throw if session has no webId', () => {
      const invalidSession: SolidSession = {
        info: { isLoggedIn: false },
        fetch: mockFetch as unknown as typeof fetch,
      };
      
      expect(() => new ProfileManager(invalidSession)).toThrow('ProfileManager requires a session with a valid webId');
    });
  });

  describe('addToProfile', () => {
    const predicate = 'http://xmlns.com/foaf/0.1/made';
    const targetUri = 'https://alice.pod/agents/my-agent.ttl#my-agent';

    it('should add link to Profile', async () => {
      const mockDataset = {};
      const mockProfile = { url: webId };
      const mockUpdatedProfile = { url: webId, updated: true };
      const mockUpdatedDataset = { updated: true };

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(mockProfile);
      (getUrlAll as any).mockReturnValue([]); // No existing links
      (addUrl as any).mockReturnValue(mockUpdatedProfile);
      (setThing as any).mockReturnValue(mockUpdatedDataset);
      (saveSolidDatasetAt as any).mockResolvedValue(undefined);

      await profileManager.addToProfile(predicate, targetUri);

      expect(getSolidDataset).toHaveBeenCalledWith(
        'https://alice.pod/profile/card',
        { fetch: mockFetch }
      );
      expect(addUrl).toHaveBeenCalledWith(
        mockProfile,
        predicate,
        targetUri
      );
      expect(saveSolidDatasetAt).toHaveBeenCalled();
    });

    it('should not add duplicate link if already exists', async () => {
      const mockDataset = {};
      const mockProfile = { url: webId };

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(mockProfile);
      (getUrlAll as any).mockReturnValue([targetUri]); // Link already exists

      await profileManager.addToProfile(predicate, targetUri);

      expect(addUrl).not.toHaveBeenCalled();
      expect(saveSolidDatasetAt).not.toHaveBeenCalled();
    });

    it('should create profile thing if not found', async () => {
      const mockDataset = {};
      const mockNewProfile = { url: webId };
      const mockUpdatedProfile = { url: webId, updated: true };
      const mockUpdatedDataset = { updated: true };

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(null); // Profile not found
      (createThing as any).mockReturnValue(mockNewProfile);
      (getUrlAll as any).mockReturnValue([]);
      (addUrl as any).mockReturnValue(mockUpdatedProfile);
      (setThing as any).mockReturnValue(mockUpdatedDataset);
      (saveSolidDatasetAt as any).mockResolvedValue(undefined);

      await profileManager.addToProfile(predicate, targetUri);

      expect(createThing).toHaveBeenCalledWith({ url: webId });
      expect(addUrl).toHaveBeenCalled();
    });
  });

  describe('removeFromProfile', () => {
    const predicate = 'http://xmlns.com/foaf/0.1/made';
    const targetUri = 'https://alice.pod/agents/my-agent.ttl#my-agent';

    it('should remove link from Profile', async () => {
      const mockDataset = {};
      const mockProfile = { url: webId };
      const mockUpdatedProfile = { url: webId, updated: true };
      const mockUpdatedDataset = { updated: true };

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(mockProfile);
      (getUrlAll as any).mockReturnValue([targetUri]); // Link exists
      (removeUrl as any).mockReturnValue(mockUpdatedProfile);
      (setThing as any).mockReturnValue(mockUpdatedDataset);
      (saveSolidDatasetAt as any).mockResolvedValue(undefined);

      await profileManager.removeFromProfile(predicate, targetUri);

      expect(removeUrl).toHaveBeenCalledWith(
        mockProfile,
        predicate,
        targetUri
      );
      expect(saveSolidDatasetAt).toHaveBeenCalled();
    });

    it('should not remove if link does not exist', async () => {
      const mockDataset = {};
      const mockProfile = { url: webId };

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(mockProfile);
      (getUrlAll as any).mockReturnValue([]); // Link doesn't exist

      await profileManager.removeFromProfile(predicate, targetUri);

      expect(removeUrl).not.toHaveBeenCalled();
      expect(saveSolidDatasetAt).not.toHaveBeenCalled();
    });
  });

  describe('isLinked', () => {
    it('should return true if link exists in Profile', async () => {
      const mockDataset = {};
      const mockProfile = { url: webId };
      const targetUri = 'https://alice.pod/agents/my-agent.ttl#my-agent';

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(mockProfile);
      (getUrlAll as any).mockReturnValue([targetUri]);

      const result = await profileManager.isLinked(
        'http://xmlns.com/foaf/0.1/made',
        targetUri
      );

      expect(result).toBe(true);
    });

    it('should return false if link does not exist', async () => {
      const mockDataset = {};
      const mockProfile = { url: webId };

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(mockProfile);
      (getUrlAll as any).mockReturnValue([]);

      const result = await profileManager.isLinked(
        'http://xmlns.com/foaf/0.1/made',
        'https://alice.pod/agents/my-agent.ttl#my-agent'
      );

      expect(result).toBe(false);
    });

    it('should return false if Profile not found', async () => {
      const mockDataset = {};

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(null);

      const result = await profileManager.isLinked(
        'http://xmlns.com/foaf/0.1/made',
        'https://alice.pod/agents/my-agent.ttl#my-agent'
      );

      expect(result).toBe(false);
    });
  });

  describe('getLinkedResources', () => {
    it('should return all linked resource URIs', async () => {
      const mockDataset = {};
      const mockProfile = { url: webId };
      const linkedUris = [
        'https://alice.pod/agents/agent1.ttl#agent1',
        'https://alice.pod/agents/agent2.ttl#agent2',
      ];

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(mockProfile);
      (getUrlAll as any).mockReturnValue(linkedUris);

      const result = await profileManager.getLinkedResources(
        'http://xmlns.com/foaf/0.1/made'
      );

      expect(result).toEqual(linkedUris);
    });

    it('should return empty array if no linked resources', async () => {
      const mockDataset = {};
      const mockProfile = { url: webId };

      (getSolidDataset as any).mockResolvedValue(mockDataset);
      (getThing as any).mockReturnValue(mockProfile);
      (getUrlAll as any).mockReturnValue([]);

      const result = await profileManager.getLinkedResources(
        'http://xmlns.com/foaf/0.1/made'
      );

      expect(result).toEqual([]);
    });
  });
});
