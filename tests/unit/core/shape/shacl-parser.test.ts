import { describe, it, expect } from 'vitest';
import { parseSHACL, xsdToDrizzleType, nodeKindToDrizzleType } from '../../../../src/core/shape/shacl-parser';
import { XSD, SHACL } from '../../../../src/core/shape/types';

describe('SHACL Parser', () => {
  describe('parseSHACL', () => {
    it('should parse a simple SHACL shape', async () => {
      const turtle = `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix schema: <http://schema.org/> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        
        <#PersonShape> a sh:NodeShape ;
          sh:targetClass schema:Person ;
          sh:name "Person Shape" ;
          sh:description "A shape for Person resources" ;
          sh:property [
            sh:path schema:name ;
            sh:name "name" ;
            sh:datatype xsd:string ;
            sh:minCount 1 ;
            sh:maxCount 1 ;
          ] ;
          sh:property [
            sh:path schema:email ;
            sh:name "email" ;
            sh:datatype xsd:string ;
          ] .
      `;

      const shapes = await parseSHACL(turtle, 'http://example.org/shapes/');
      
      expect(shapes).toHaveLength(1);
      
      const personShape = shapes[0];
      expect(personShape.targetClass).toBe('http://schema.org/Person');
      expect(personShape.name).toBe('Person Shape');
      expect(personShape.description).toBe('A shape for Person resources');
      expect(personShape.properties).toHaveLength(2);
      
      // Check name property
      const nameProp = personShape.properties.find(p => p.name === 'name');
      expect(nameProp).toBeDefined();
      expect(nameProp?.path).toBe('http://schema.org/name');
      expect(nameProp?.datatype).toBe(XSD.STRING);
      expect(nameProp?.minCount).toBe(1);
      expect(nameProp?.maxCount).toBe(1);
      
      // Check email property
      const emailProp = personShape.properties.find(p => p.name === 'email');
      expect(emailProp).toBeDefined();
      expect(emailProp?.path).toBe('http://schema.org/email');
    });

    it('should parse inverse path properties', async () => {
      const turtle = `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix schema: <http://schema.org/> .
        
        <#PostShape> a sh:NodeShape ;
          sh:targetClass schema:BlogPosting ;
          sh:property [
            sh:path [ sh:inversePath schema:author ] ;
            sh:name "posts" ;
          ] .
      `;

      const shapes = await parseSHACL(turtle);
      
      expect(shapes).toHaveLength(1);
      
      const postsProp = shapes[0].properties.find(p => p.name === 'posts');
      expect(postsProp).toBeDefined();
      expect(postsProp?.inverse).toBe(true);
      expect(postsProp?.path).toBe('http://schema.org/author');
    });

    it('should parse nodeKind constraints', async () => {
      const turtle = `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix schema: <http://schema.org/> .
        
        <#PersonShape> a sh:NodeShape ;
          sh:targetClass schema:Person ;
          sh:property [
            sh:path schema:knows ;
            sh:name "knows" ;
            sh:nodeKind sh:IRI ;
            sh:class schema:Person ;
          ] .
      `;

      const shapes = await parseSHACL(turtle);
      
      const knowsProp = shapes[0].properties.find(p => p.name === 'knows');
      expect(knowsProp).toBeDefined();
      expect(knowsProp?.nodeKind).toBe(SHACL.IRI);
      expect(knowsProp?.class).toBe('http://schema.org/Person');
    });

    it('should handle multiple shapes', async () => {
      const turtle = `
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix schema: <http://schema.org/> .
        
        <#PersonShape> a sh:NodeShape ;
          sh:targetClass schema:Person ;
          sh:property [
            sh:path schema:name ;
            sh:name "name" ;
          ] .
        
        <#ArticleShape> a sh:NodeShape ;
          sh:targetClass schema:Article ;
          sh:property [
            sh:path schema:headline ;
            sh:name "headline" ;
          ] .
      `;

      const shapes = await parseSHACL(turtle);
      
      expect(shapes).toHaveLength(2);
      expect(shapes.map(s => s.targetClass)).toContain('http://schema.org/Person');
      expect(shapes.map(s => s.targetClass)).toContain('http://schema.org/Article');
    });

    it('should return empty array for invalid turtle', async () => {
      const invalidTurtle = 'this is not valid turtle';
      
      await expect(parseSHACL(invalidTurtle)).rejects.toThrow();
    });

    it('should return empty array when no shapes found', async () => {
      const turtle = `
        @prefix schema: <http://schema.org/> .
        
        <#something> a schema:Thing .
      `;

      const shapes = await parseSHACL(turtle);
      expect(shapes).toHaveLength(0);
    });
  });

  describe('xsdToDrizzleType', () => {
    it('should map XSD types to Drizzle types', () => {
      expect(xsdToDrizzleType(XSD.STRING)).toBe('string');
      expect(xsdToDrizzleType(XSD.INTEGER)).toBe('integer');
      expect(xsdToDrizzleType(XSD.BOOLEAN)).toBe('boolean');
      expect(xsdToDrizzleType(XSD.DATETIME)).toBe('datetime');
      expect(xsdToDrizzleType(XSD.DATE)).toBe('datetime');
      expect(xsdToDrizzleType(XSD.ANYURI)).toBe('uri');
      expect(xsdToDrizzleType(XSD.DECIMAL)).toBe('number');
      expect(xsdToDrizzleType(XSD.DOUBLE)).toBe('number');
    });

    it('should default to string for unknown types', () => {
      expect(xsdToDrizzleType('http://example.org/CustomType')).toBe('string');
      expect(xsdToDrizzleType(undefined)).toBe('string');
    });
  });

  describe('nodeKindToDrizzleType', () => {
    it('should map SHACL nodeKind to Drizzle types', () => {
      expect(nodeKindToDrizzleType(SHACL.IRI)).toBe('uri');
      expect(nodeKindToDrizzleType(SHACL.LITERAL)).toBe('string');
      expect(nodeKindToDrizzleType(SHACL.BLANK_NODE)).toBe('object');
    });

    it('should return undefined for unknown nodeKind', () => {
      expect(nodeKindToDrizzleType('http://example.org/CustomKind')).toBeUndefined();
      expect(nodeKindToDrizzleType(undefined)).toBeUndefined();
    });
  });
});
