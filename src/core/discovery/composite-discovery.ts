import { PodTable } from '../pod-table';
import { DataDiscovery, DataLocation } from './types';

export class CompositeDiscovery implements DataDiscovery {
  constructor(private strategies: DataDiscovery[]) {}

  async register(table: PodTable): Promise<void> {
    // Register mainly with the first strategy (usually TypeIndex) as default
    // or try all until one succeeds?
    // For now, we use the first one that doesn't fail.
    for (const strategy of this.strategies) {
      try {
        await strategy.register(table);
        return; // Success
      } catch (e) {
        console.warn('Registration failed with strategy, trying next:', e);
      }
    }
    throw new Error('Failed to register table with any discovery strategy');
  }

  async discover(rdfClass: string): Promise<DataLocation[]> {
    const allLocations: DataLocation[] = [];
    for (const strategy of this.strategies) {
      try {
        const locations = await strategy.discover(rdfClass);
        allLocations.push(...locations);
      } catch (e) {
        console.warn('Discovery failed with strategy, trying next:', e);
      }
    }
    return allLocations;
  }

  async isRegistered(rdfClass: string): Promise<boolean> {
    for (const strategy of this.strategies) {
      if (await strategy.isRegistered(rdfClass)) return true;
    }
    return false;
  }
}
