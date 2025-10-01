import { describe, it, expect } from '@jest/globals';
import {
  parseRDFSchema,
  getPredicateTypeScriptType,
  validatePredicateType,
  findPredicateType,
  rdfTypeToTypeScript
} from '@src/core/rdf-schema-parser';

describe('RDF Schema Parser', () => {
  const mockTurtleSchema = `
@prefix schema: <https://schema.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

# 类型定义
schema:name rdfs:range xsd:string .
schema:dateCreated rdfs:range xsd:dateTime .
schema:age rdfs:range xsd:integer .
schema:isActive rdfs:range xsd:boolean .
schema:author rdfs:range schema:Person .
schema:url rdfs:range xsd:anyURI .
`;

  describe('parseRDFSchema', () => {
    it('应该解析 Turtle 格式的 RDF Schema', async () => {
      // Mock fetch 函数
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockTurtleSchema)
      });

      const result = await parseRDFSchema('https://example.org/schema', mockFetch);

      expect(result.errors).toHaveLength(0);
      expect(result.definitions).toHaveLength(6);
      
      // 检查解析结果
      const nameDef = result.definitions.find(def => def.predicate === 'schema:name');
      expect(nameDef?.range).toBe('xsd:string');
      
      const dateDef = result.definitions.find(def => def.predicate === 'schema:dateCreated');
      expect(dateDef?.range).toBe('xsd:dateTime');
    });

    it('应该处理网络错误', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const result = await parseRDFSchema('https://example.org/schema', mockFetch);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to fetch schema');
    });
  });

  describe('findPredicateType', () => {
    const mockDefinitions = [
      { predicate: 'schema:name', range: 'xsd:string' },
      { predicate: 'schema:age', range: 'xsd:integer' },
      { predicate: 'schema:isActive', range: 'xsd:boolean' }
    ];

    it('应该找到已知 predicate 的类型', () => {
      const type = findPredicateType('schema:name', mockDefinitions);
      expect(type).toBe('xsd:string');
    });

    it('应该返回 null 对于未知 predicate', () => {
      const type = findPredicateType('schema:unknown', mockDefinitions);
      expect(type).toBeNull();
    });
  });

  describe('rdfTypeToTypeScript', () => {
    it('应该正确映射 RDF 类型到 TypeScript 类型', () => {
      expect(rdfTypeToTypeScript('http://www.w3.org/2001/XMLSchema#string')).toBe('string');
      expect(rdfTypeToTypeScript('http://www.w3.org/2001/XMLSchema#integer')).toBe('number');
      expect(rdfTypeToTypeScript('http://www.w3.org/2001/XMLSchema#boolean')).toBe('boolean');
      expect(rdfTypeToTypeScript('http://www.w3.org/2001/XMLSchema#dateTime')).toBe('Date');
      expect(rdfTypeToTypeScript('http://www.w3.org/2001/XMLSchema#anyURI')).toBe('string');
    });

    it('应该返回默认类型对于未知 RDF 类型', () => {
      expect(rdfTypeToTypeScript('http://example.org/unknown')).toBe('string');
    });
  });

  describe('getPredicateTypeScriptType', () => {
    const mockDefinitions = [
      { predicate: 'schema:name', range: 'xsd:string' },
      { predicate: 'schema:age', range: 'xsd:integer' },
      { predicate: 'schema:isActive', range: 'xsd:boolean' },
      { predicate: 'schema:dateCreated', range: 'xsd:dateTime' }
    ];

    it('应该返回正确的 TypeScript 类型', () => {
      expect(getPredicateTypeScriptType('schema:name', mockDefinitions)).toBe('string');
      expect(getPredicateTypeScriptType('schema:age', mockDefinitions)).toBe('number');
      expect(getPredicateTypeScriptType('schema:isActive', mockDefinitions)).toBe('boolean');
      expect(getPredicateTypeScriptType('schema:dateCreated', mockDefinitions)).toBe('Date');
    });

    it('应该返回默认类型对于未知 predicate', () => {
      expect(getPredicateTypeScriptType('schema:unknown', mockDefinitions)).toBe('string');
    });
  });

  describe('validatePredicateType', () => {
    const mockDefinitions = [
      { predicate: 'schema:name', range: 'xsd:string' },
      { predicate: 'schema:age', range: 'xsd:integer' },
      { predicate: 'schema:isActive', range: 'xsd:boolean' }
    ];

    it('应该验证正确的类型', () => {
      const result = validatePredicateType('schema:name', 'string', mockDefinitions);
      expect(result.isValid).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('应该检测错误的类型', () => {
      const result = validatePredicateType('schema:name', 'number', mockDefinitions);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('is defined as string in RDF Schema, but you\'re using number');
    });

    it('应该处理未知 predicate', () => {
      const result = validatePredicateType('schema:unknown', 'string', mockDefinitions);
      expect(result.isValid).toBe(true); // 未知 predicate 使用默认类型 string
    });
  });

  describe('parseTurtleSchema', () => {
    it('应该解析复杂的 Turtle 文档', () => {
      const complexTurtle = `
@prefix schema: <https://schema.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

# 注释行
schema:name rdfs:range xsd:string .
schema:age rdfs:range xsd:integer .

# 空行

schema:isActive rdfs:range xsd:boolean .
`;

      // 这里需要测试 parseTurtleSchema 函数，但它是私有的
      // 我们可以通过 parseRDFSchema 来间接测试
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(complexTurtle)
      });

      return parseRDFSchema('https://example.org/schema', mockFetch).then(result => {
        expect(result.errors).toHaveLength(0);
        expect(result.definitions).toHaveLength(3);
      });
    });
  });
});
