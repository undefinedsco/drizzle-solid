import { describe, it, expect } from 'vitest';
import {
  RDF_NAMESPACES,
  buildURI,
  getLocalName,
  getNamespace
} from '@src/core/rdf-constants';

describe('RDF Constants', () => {
  describe('RDF_NAMESPACES', () => {
    it('应该包含所有必需的命名空间', () => {
      expect(RDF_NAMESPACES.RDF).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
      expect(RDF_NAMESPACES.SCHEMA).toBe('https://schema.org/');
      expect(RDF_NAMESPACES.SOLID).toBe('http://www.w3.org/ns/solid/terms#');
    });
  });

  describe('buildURI', () => {
    it('应该正确构建 URI', () => {
      expect(buildURI('RDF', 'type')).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
      expect(buildURI('SCHEMA', 'Person')).toBe('https://schema.org/Person');
    });
  });

  describe('getLocalName', () => {
    it('应该能提取本地名称 (hash)', () => {
      expect(getLocalName('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBe('type');
    });

    it('应该能提取本地名称 (slash)', () => {
      expect(getLocalName('https://schema.org/Person')).toBe('Person');
    });
  });

  describe('getNamespace', () => {
    it('应该能提取命名空间 (hash)', () => {
      expect(getNamespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
    });

    it('应该能提取命名空间 (slash)', () => {
      expect(getNamespace('https://schema.org/Person')).toBe('https://schema.org/');
    });
  });
});