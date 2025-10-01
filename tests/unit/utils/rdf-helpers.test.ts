import { describe, it, expect } from '@jest/globals';
import { 
  validateTriple, 
  generateResourceUri,
  formatError,
  buildSparqlQuery
} from '@src/utils/rdf-helpers';

describe('RDF Helpers', () => {
  describe('validateTriple', () => {
    it('should validate correct triples', () => {
      const validTriple = {
        subject: 'https://example.com/subject',
        predicate: 'https://example.com/predicate',
        object: 'value'
      };

      expect(validateTriple(validTriple)).toBe(true);
    });

    it('should reject invalid triples', () => {
      const invalidTriple = {
        subject: 'https://example.com/subject',
        predicate: 'https://example.com/predicate',
        object: null
      };

      expect(validateTriple(invalidTriple)).toBe(false);
    });
  });

  describe('generateResourceUri', () => {
    it('should generate unique URIs', () => {
      const baseUri = 'https://example.com/pod';
      const resourceType = 'person';
      
      const uri1 = generateResourceUri(baseUri, resourceType);
      const uri2 = generateResourceUri(baseUri, resourceType);
      
      expect(uri1).toMatch(new RegExp(`^${baseUri}/${resourceType}/\\d+-[a-z0-9]+$`));
      expect(uri1).not.toBe(uri2);
    });

    it('should use provided ID', () => {
      const baseUri = 'https://example.com/pod';
      const resourceType = 'person';
      const id = '123';
      
      const uri = generateResourceUri(baseUri, resourceType, id);
      
      expect(uri).toBe(`${baseUri}/${resourceType}/${id}`);
    });
  });

  describe('formatError', () => {
    it('should format Error objects', () => {
      const error = new Error('Test error');
      expect(formatError(error)).toBe('Test error');
    });

    it('should format non-Error values', () => {
      expect(formatError('String error')).toBe('String error');
      expect(formatError(123)).toBe('123');
    });
  });

  describe('buildSparqlQuery', () => {
    it('should build basic SPARQL query', () => {
      const query = buildSparqlQuery(
        ['name', 'email'],
        'https://example.com/graph'
      );

      expect(query).toContain('SELECT ?name ?email');
      expect(query).toContain('GRAPH <https://example.com/graph>');
    });

    it('should build SPARQL query with conditions', () => {
      const query = buildSparqlQuery(
        ['name', 'email'],
        'https://example.com/graph',
        { name: 'John', email: 'john@example.com' }
      );

      expect(query).toContain('?subject <http://schema.org/name> "John"');
      expect(query).toContain('?subject <http://schema.org/email> "john@example.com"');
    });
  });
}); 