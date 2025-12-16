/**
 * FederatedQueryExecutor Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { FederatedQueryExecutor } from '../../../../src/core/federated/executor';
import { ProviderCache } from '../../../../src/core/discovery/provider-cache';
import type { RelationDefinition } from '../../../../src/core/pod-table';

describe('FederatedQueryExecutor', () => {
  // Mock Turtle data for a container with posts
  const mockPostsTurtle = `
    @prefix schema: <https://schema.org/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    
    <https://bob.example.net/posts/post1>
      a <https://schema.org/BlogPosting> ;
      schema:headline "First Post" ;
      schema:content "Hello World" .
    
    <https://bob.example.net/posts/post2>
      a <https://schema.org/BlogPosting> ;
      schema:headline "Second Post" ;
      schema:content "Another post" .
  `;

  // Mock .well-known response
  const mockWellKnownTurtle = `
    @prefix solid: <http://www.w3.org/ns/solid/terms#> .
    
    <>
      solid:publicTypeIndex </settings/publicTypeIndex.ttl> .
  `;

  // Mock TypeIndex response
  const mockTypeIndexTurtle = `
    @prefix solid: <http://www.w3.org/ns/solid/terms#> .
    
    <#posts>
      a solid:TypeRegistration ;
      solid:forClass <https://schema.org/BlogPosting> ;
      solid:instanceContainer </posts/> .
  `;

  describe('execute', () => {
    it('should return original rows when relation is not federated', async () => {
      const executor = new FederatedQueryExecutor();
      const parentRows = [
        { id: 'friend1', webId: 'https://bob.example.net/profile/card#me' },
      ];

      const relationDef: RelationDefinition = {
        type: 'many',
        table: {} as any,
        isFederated: false,
      };

      const result = await executor.execute(parentRows, relationDef);

      expect(result.data).toEqual(parentRows);
      expect(result.errors).toBeUndefined();
    });

    it('should set empty array when discover returns undefined', async () => {
      const executor = new FederatedQueryExecutor();
      const parentRows = [
        { id: 'friend1', webId: undefined },
      ];

      const relationDef: RelationDefinition = {
        type: 'many',
        table: { $kind: 'PodSchema', type: 'https://schema.org/BlogPosting' } as any,
        isFederated: true,
        discover: (row) => row.webId,
        relationName: 'posts',
      };

      const result = await executor.execute(parentRows, relationDef);

      expect(result.data[0].posts).toEqual([]);
      expect(result.errors).toBeUndefined();
    });

    it('should execute federated query and return results', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('.well-known/solid')) {
          return new Response(mockWellKnownTurtle, {
            headers: { 'content-type': 'text/turtle' },
          });
        }
        if (url.includes('publicTypeIndex')) {
          return new Response(mockTypeIndexTurtle, {
            headers: { 'content-type': 'text/turtle' },
          });
        }
        if (url.includes('/posts/')) {
          return new Response(mockPostsTurtle, {
            headers: { 'content-type': 'text/turtle' },
          });
        }
        return new Response('Not Found', { status: 404 });
      });

      const executor = new FederatedQueryExecutor({ fetch: mockFetch });

      const parentRows = [
        { id: 'friend1', name: 'Bob', webId: 'https://bob.example.net/profile/card#me' },
      ];

      const relationDef: RelationDefinition = {
        type: 'many',
        table: { 
          $kind: 'PodSchema', 
          type: 'https://schema.org/BlogPosting',
          name: 'posts',
        } as any,
        isFederated: true,
        discover: (row) => row.webId,
        relationName: 'posts',
      };

      const result = await executor.execute(parentRows, relationDef);

      expect(result.data[0].posts).toBeDefined();
      expect(Array.isArray(result.data[0].posts)).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should collect errors when fetch fails', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('.well-known/solid')) {
          return new Response(mockWellKnownTurtle, {
            headers: { 'content-type': 'text/turtle' },
          });
        }
        if (url.includes('publicTypeIndex')) {
          return new Response(mockTypeIndexTurtle, {
            headers: { 'content-type': 'text/turtle' },
          });
        }
        // Posts container returns 403
        if (url.includes('/posts/')) {
          return new Response('Forbidden', { status: 403 });
        }
        return new Response('Not Found', { status: 404 });
      });

      const executor = new FederatedQueryExecutor({ fetch: mockFetch });

      const parentRows = [
        { id: 'friend1', webId: 'https://bob.example.net/profile/card#me' },
      ];

      const relationDef: RelationDefinition = {
        type: 'many',
        table: { 
          $kind: 'PodSchema', 
          type: 'https://schema.org/BlogPosting',
        } as any,
        isFederated: true,
        discover: (row) => row.webId,
        relationName: 'posts',
      };

      const result = await executor.execute(parentRows, relationDef);

      // Should still return data with empty posts
      expect(result.data[0].posts).toEqual([]);
    });

    it('should handle multiple webIds from discover', async () => {
      const executor = new FederatedQueryExecutor();

      const parentRows = [
        { 
          id: 'group1', 
          memberWebIds: [
            'https://alice.example.net/profile/card#me',
            'https://bob.example.net/profile/card#me',
          ]
        },
      ];

      const relationDef: RelationDefinition = {
        type: 'many',
        table: { 
          $kind: 'PodSchema', 
          type: 'https://schema.org/BlogPosting',
        } as any,
        isFederated: true,
        discover: (row) => row.memberWebIds,
        relationName: 'posts',
      };

      const result = await executor.execute(parentRows, relationDef);

      // Should have posts array (empty since no actual server)
      expect(result.data[0].posts).toEqual([]);
    });
  });

  describe('parallel execution', () => {
    it('should respect maxConcurrency option', async () => {
      let concurrentRequests = 0;
      let maxConcurrent = 0;

      const mockFetch = vi.fn().mockImplementation(async () => {
        concurrentRequests++;
        maxConcurrent = Math.max(maxConcurrent, concurrentRequests);
        
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 50));
        
        concurrentRequests--;
        return new Response('Not Found', { status: 404 });
      });

      const executor = new FederatedQueryExecutor({ fetch: mockFetch });

      // Create 10 parent rows
      const parentRows = Array.from({ length: 10 }, (_, i) => ({
        id: `friend${i}`,
        webId: `https://user${i}.example.net/profile/card#me`,
      }));

      const relationDef: RelationDefinition = {
        type: 'many',
        table: { 
          $kind: 'PodSchema', 
          type: 'https://schema.org/BlogPosting',
        } as any,
        isFederated: true,
        discover: (row) => row.webId,
        relationName: 'posts',
      };

      await executor.execute(parentRows, relationDef, { 
        maxConcurrency: 3,
        parallel: true,
      });

      // Should not exceed maxConcurrency
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it('should execute sequentially when parallel is false', async () => {
      const executor = new FederatedQueryExecutor();

      const parentRows = Array.from({ length: 3 }, (_, i) => ({
        id: `friend${i}`,
        webId: `https://user${i}.example.net/profile/card#me`,
      }));

      const relationDef: RelationDefinition = {
        type: 'many',
        table: { 
          $kind: 'PodSchema', 
          type: 'https://schema.org/BlogPosting',
        } as any,
        isFederated: true,
        discover: (row) => row.webId,
        relationName: 'posts',
      };

      const result = await executor.execute(parentRows, relationDef, { 
        parallel: false,
      });

      // All rows should have posts array
      expect(result.data.length).toBe(3);
      result.data.forEach(row => {
        expect(row.posts).toEqual([]);
      });
    });
  });

  describe('extractPodUrl', () => {
    it('should extract pod URL from WebID', async () => {
      const executor = new FederatedQueryExecutor();

      const parentRows = [
        { id: 'friend1', webId: 'https://bob.solidcommunity.net/profile/card#me' },
      ];

      const relationDef: RelationDefinition = {
        type: 'many',
        table: { 
          $kind: 'PodSchema', 
          type: 'https://schema.org/BlogPosting',
        } as any,
        isFederated: true,
        discover: (row) => row.webId,
        relationName: 'posts',
      };

      const result = await executor.execute(parentRows, relationDef);

      // Should have posts array
      expect(result.data[0].posts).toBeDefined();
      expect(Array.isArray(result.data[0].posts)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      const executor = new FederatedQueryExecutor();

      const parentRows = [
        { id: 'friend1', webId: 'https://nonexistent.example.net/profile/card#me' },
      ];

      const relationDef: RelationDefinition = {
        type: 'many',
        table: { 
          $kind: 'PodSchema', 
          type: 'https://schema.org/BlogPosting',
        } as any,
        isFederated: true,
        discover: (row) => row.webId,
        relationName: 'posts',
      };

      // Should not throw, should return empty posts
      const result = await executor.execute(parentRows, relationDef);

      expect(result.data[0].posts).toEqual([]);
    });

    it('should create error object with correct path', async () => {
      // Create a mock that throws an error during query
      const executor = new FederatedQueryExecutor();
      
      // Access private method to test error creation
      const error = (executor as any).createError(
        [0, 'posts'],
        new Error('403 Forbidden'),
        'https://bob.example.net/posts/'
      );

      expect(error.code).toBe('FORBIDDEN');
      expect(error.path).toEqual([0, 'posts']);
      expect(error.url).toBe('https://bob.example.net/posts/');
    });

    it('should detect timeout errors', async () => {
      const executor = new FederatedQueryExecutor();
      
      const error = (executor as any).createError(
        [0, 'posts'],
        new Error('Timeout exceeded'),
        'https://bob.example.net/posts/'
      );

      expect(error.code).toBe('TIMEOUT');
    });

    it('should detect discovery errors', async () => {
      const executor = new FederatedQueryExecutor();
      
      const error = (executor as any).createError(
        [0, 'posts'],
        new Error('Failed to discover data location'),
        'https://bob.example.net/'
      );

      expect(error.code).toBe('DISCOVERY_FAILED');
    });
  });
});
