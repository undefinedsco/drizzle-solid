/**
 * ProfileManager - Utility class for managing user's Profile document.
 * 
 * Use this in table hooks to add/remove links from the user's Profile.
 * 
 * @example
 * hooks: {
 *   afterInsert: async (ctx, record) => {
 *     if (record.public) {
 *       const pm = new ProfileManager(ctx.session);
 *       await pm.addToProfile('http://xmlns.com/foaf/0.1/made', record['@id']);
 *     }
 *   },
 * }
 */

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
import type { SolidSession } from './pod-table';

/**
 * Manages links in the user's Profile document.
 * Use this to implement publish/unpublish patterns or manage social connections.
 * 
 * @example
 * // In a table hook
 * const pm = new ProfileManager(ctx.session);
 * 
 * // Publish a resource (link via foaf:made)
 * await pm.addToProfile('http://xmlns.com/foaf/0.1/made', agentUri);
 * 
 * // Add a friend (link via foaf:knows)
 * await pm.addToProfile('http://xmlns.com/foaf/0.1/knows', friendWebId);
 * 
 * // Add an interest
 * await pm.addToProfile('http://xmlns.com/foaf/0.1/interest', topicUri);
 */
export class ProfileManager {
  private fetchFn: typeof globalThis.fetch;
  private webId: string;

  /**
   * Create a ProfileManager instance.
   * 
   * @param session - The Solid authentication session (compatible with Inrupt Session)
   * 
   * @example
   * // In a table hook
   * afterInsert: async (ctx, record) => {
   *   const pm = new ProfileManager(ctx.session);
   *   await pm.addToProfile('foaf:made', record['@id']);
   * }
   */
  constructor(session: SolidSession) {
    if (!session.info.webId) {
      throw new Error('ProfileManager requires a session with a valid webId');
    }
    this.fetchFn = session.fetch;
    this.webId = session.info.webId;
  }

  /**
   * Add a link from the user's Profile to a target URI.
   * 
   * @param predicate - The RDF predicate to use (e.g., 'http://xmlns.com/foaf/0.1/made')
   * @param targetUri - The URI to link to (e.g., the resource's @id)
   * 
   * @example
   * await pm.addToProfile('http://xmlns.com/foaf/0.1/made', record['@id']);
   */
  async addToProfile(predicate: string, targetUri: string): Promise<void> {
    // Get the profile document URL (remove the #me fragment)
    const profileDocUrl = this.webId.split('#')[0];
    
    let profileDataset = await getSolidDataset(profileDocUrl, { fetch: this.fetchFn });
    let profile = getThing(profileDataset, this.webId);
    
    if (!profile) {
      console.warn('[ProfileManager] Profile thing not found, creating new thing');
      profile = createThing({ url: this.webId });
    }

    // Check if the link already exists
    const existingLinks = getUrlAll(profile, predicate);
    if (existingLinks.includes(targetUri)) {
      console.log(`[ProfileManager] Link already exists: ${predicate} -> ${targetUri}`);
      return;
    }

    // Add the new link
    profile = addUrl(profile, predicate, targetUri);
    profileDataset = setThing(profileDataset, profile);
    
    await saveSolidDatasetAt(profileDocUrl, profileDataset, { fetch: this.fetchFn });
    console.log(`[ProfileManager] Added link: ${predicate} -> ${targetUri}`);
  }

  /**
   * Remove a link from the user's Profile to a target URI.
   * 
   * @param predicate - The RDF predicate (e.g., 'http://xmlns.com/foaf/0.1/made')
   * @param targetUri - The URI to unlink (e.g., the resource's @id)
   * 
   * @example
   * await pm.removeFromProfile('http://xmlns.com/foaf/0.1/made', record['@id']);
   */
  async removeFromProfile(predicate: string, targetUri: string): Promise<void> {
    const profileDocUrl = this.webId.split('#')[0];
    
    let profileDataset = await getSolidDataset(profileDocUrl, { fetch: this.fetchFn });
    let profile = getThing(profileDataset, this.webId);
    
    if (!profile) {
      console.warn('[ProfileManager] Profile thing not found, nothing to remove');
      return;
    }

    // Check if the link exists
    const existingLinks = getUrlAll(profile, predicate);
    if (!existingLinks.includes(targetUri)) {
      console.log(`[ProfileManager] Link not found: ${predicate} -> ${targetUri}`);
      return;
    }

    // Remove the link
    profile = removeUrl(profile, predicate, targetUri);
    profileDataset = setThing(profileDataset, profile);
    
    await saveSolidDatasetAt(profileDocUrl, profileDataset, { fetch: this.fetchFn });
    console.log(`[ProfileManager] Removed link: ${predicate} -> ${targetUri}`);
  }

  /**
   * Check if a resource is currently linked from the Profile.
   * 
   * @param predicate - The RDF predicate to check
   * @param targetUri - The URI to check for
   * @returns true if the link exists, false otherwise
   */
  async isLinked(predicate: string, targetUri: string): Promise<boolean> {
    const profileDocUrl = this.webId.split('#')[0];
    
    try {
      const profileDataset = await getSolidDataset(profileDocUrl, { fetch: this.fetchFn });
      const profile = getThing(profileDataset, this.webId);
      
      if (!profile) {
        return false;
      }

      const existingLinks = getUrlAll(profile, predicate);
      return existingLinks.includes(targetUri);
    } catch (error) {
      console.warn('[ProfileManager] Error checking link status:', error);
      return false;
    }
  }

  /**
   * Get all URIs linked from the Profile with the given predicate.
   * 
   * @param predicate - The RDF predicate to query
   * @returns Array of linked URIs
   */
  async getLinkedResources(predicate: string): Promise<string[]> {
    const profileDocUrl = this.webId.split('#')[0];
    
    try {
      const profileDataset = await getSolidDataset(profileDocUrl, { fetch: this.fetchFn });
      const profile = getThing(profileDataset, this.webId);
      
      if (!profile) {
        return [];
      }

      return getUrlAll(profile, predicate);
    } catch (error) {
      console.warn('[ProfileManager] Error getting linked resources:', error);
      return [];
    }
  }

  /**
   * Get the user's WebID.
   */
  getWebId(): string {
    return this.webId;
  }
}
