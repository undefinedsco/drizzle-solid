/**
 * ShapeManager Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ShapeManager,
  DrizzleShapeManager,
  Shape,
  XSD,
  SHACL,
} from '../../../../src/core/shape';
import { podTable, string, int, boolean, id, uri } from '../../../../src/core/schema';

// 测试用命名空间
const ns = { prefix: 'schema', uri: 'https://schema.org/' };

describe('ShapeManager', () => {
  let manager: DrizzleShapeManager;
  const podUrl = 'https://example.com/';

  beforeEach(() => {
    manager = new DrizzleShapeManager(podUrl);
  });

  describe('generateShape', () => {
    it('should generate shape from podTable', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').notNull().predicate('https://schema.org/name'),
        age: int('age').predicate('https://schema.org/age'),
        active: boolean('active').predicate('https://schema.org/isActive'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const shape = manager.generateShape(table);

      expect(shape.uri).toBe('https://example.com/data/users/shapes/usersShape.ttl#usersShape');
      expect(shape.targetClass).toBe('https://schema.org/Person');
      expect(shape.name).toBe('users Shape');
      expect(shape.properties).toHaveLength(3); 
    });

    it('should set correct property constraints', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').notNull().predicate('https://schema.org/name'),
        email: string('email').predicate('https://schema.org/email'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const shape = manager.generateShape(table);

      const nameProp = shape.properties.find(p => p.path === 'https://schema.org/name');
      expect(nameProp).toBeDefined();
      expect(nameProp!.minCount).toBe(1); // required
      expect(nameProp!.maxCount).toBe(1); // not array
      expect(nameProp!.datatype).toBe(XSD.STRING);

      const emailProp = shape.properties.find(p => p.path === 'https://schema.org/email');
      expect(emailProp).toBeDefined();
      expect(emailProp!.minCount).toBeUndefined(); // not required (0)
      expect(emailProp!.maxCount).toBe(1);
    });

    it('should handle URI type with nodeKind IRI', () => {
      const table = podTable('bookmarks', {
        id: id(),
        url: uri('url').notNull().predicate('https://schema.org/url'),
      }, {
        base: '/data/bookmarks/',
        type: 'https://schema.org/Bookmark',
        namespace: ns,
      });

      const shape = manager.generateShape(table);

      const urlProp = shape.properties.find(p => p.path === 'https://schema.org/url');
      expect(urlProp).toBeDefined();
      expect(urlProp!.nodeKind).toBe('http://www.w3.org/ns/shacl#IRI'); // Full URI
      expect(urlProp!.datatype).toBe('http://www.w3.org/2001/XMLSchema#anyURI');
    });

    it('should handle reference type', () => {
      const table = podTable('posts', {
        id: id(),
        author: string('author')
          .predicate('https://schema.org/author')
          .reference('https://schema.org/Person'),
      }, {
        base: '/data/posts/',
        type: 'https://schema.org/BlogPosting',
        namespace: ns,
      });

      const shape = manager.generateShape(table);

      const authorProp = shape.properties.find(p => p.path === 'https://schema.org/author');
      expect(authorProp).toBeDefined();
      expect(authorProp!.nodeKind).toBe('http://www.w3.org/ns/shacl#IRI'); // Full URI
      expect(authorProp!.class).toBe('https://schema.org/Person');
    });
  });

  describe('toSHACL', () => {
    it('should generate valid SHACL Turtle', () => {
      const table = podTable('users', {
        id: id(),
        name: string('name').notNull().predicate('https://schema.org/name'),
      }, {
        base: '/data/users/',
        type: 'https://schema.org/Person',
        namespace: ns,
      });

      const shape = manager.generateShape(table);
      const shacl = manager.toSHACL(shape);

      expect(shacl).toContain('@prefix sh: <http://www.w3.org/ns/shacl#>');
      expect(shacl).toContain('a sh:NodeShape');
      expect(shacl).toContain('sh:targetClass <https://schema.org/Person>');
      expect(shacl).toContain('sh:path <https://schema.org/name>');
      expect(shacl).toContain('sh:minCount 1');
      expect(shacl).toContain('sh:maxCount 1');
    });

    it('should include shape name and description', () => {
      const shape = {
        uri: 'https://example.org/UserShape',
        targetClass: 'https://schema.org/Person',
        name: 'User Shape',
        description: 'Shape for validating user data',
        properties: [],
      };

      const shacl = manager.toSHACL(shape);

      expect(shacl).toContain('sh:name "User Shape"');
      expect(shacl).toContain('sh:description "Shape for validating user data"');
    });
  });

  describe('validate', () => {
    it('should validate valid data', () => {
      const shape = {
        uri: 'https://example.org/UserShape',
        targetClass: 'https://schema.org/Person',
        properties: [
          {
            path: 'https://schema.org/name',
            name: 'name',
            datatype: XSD.STRING,
            minCount: 1,
            maxCount: 1,
          },
        ],
      };

      const result = manager.validate({ name: 'Alice' }, shape);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect missing required field', () => {
      const shape = {
        uri: 'https://example.org/UserShape',
        targetClass: 'https://schema.org/Person',
        properties: [
          {
            path: 'https://schema.org/name',
            name: 'name',
            datatype: XSD.STRING,
            minCount: 1,
            maxCount: 1,
          },
        ],
      };

      const result = manager.validate({}, shape);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      // Zod returns 'invalid_type' for missing required fields
      expect(result.errors![0].constraint).toBe('invalid_type');
    });

    it('should detect wrong data type', () => {
      const shape = {
        uri: 'https://example.org/UserShape',
        targetClass: 'https://schema.org/Person',
        properties: [
          {
            path: 'https://schema.org/age',
            name: 'age',
            datatype: XSD.INTEGER,
            maxCount: 1,
          },
        ],
      };

      const result = manager.validate({ age: 'twenty' }, shape);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      // Zod for z.number().int().or(z.string().regex) with non-numeric string results in 'invalid_format'
      expect(result.errors![0].constraint).toBe('invalid_format');
    });

    it('should validate IRI nodeKind', () => {
      const shape = {
        uri: 'https://example.org/BookmarkShape',
        targetClass: 'https://schema.org/Bookmark',
        properties: [
          {
            path: 'https://schema.org/url',
            name: 'url',
            nodeKind: SHACL.IRI, // Use full URI
            minCount: 1,
            maxCount: 1,
          },
        ],
      };

      // Valid IRI
      const validResult = manager.validate(
        { url: 'https://example.com/page' },
        shape
      );
      expect(validResult.valid).toBe(true);

      // Invalid IRI
      const invalidResult = manager.validate(
        { url: 'not-a-url' },
        shape
      );
      expect(invalidResult.valid).toBe(false);
      // Zod .url().or(startsWith) for invalid input results in 'invalid_union'
      expect(invalidResult.errors![0].constraint).toBe('invalid_union');
    });

    it('should validate pattern constraint', () => {
      const shape = {
        uri: 'https://example.org/UserShape',
        targetClass: 'https://schema.org/Person',
        properties: [
          {
            path: 'https://schema.org/email',
            name: 'email',
            datatype: XSD.STRING,
            pattern: '^[^@]+@[^@]+\\.[^@]+$',
            maxCount: 1,
          },
        ],
      };

      // Valid email
      const validResult = manager.validate(
        { email: 'test@example.com' },
        shape
      );
      expect(validResult.valid).toBe(true);

      // Invalid email
      const invalidResult = manager.validate(
        { email: 'not-an-email' },
        shape
      );
      expect(invalidResult.valid).toBe(false);
      // Zod regex mismatch in this environment reports 'invalid_format'
      expect(invalidResult.errors![0].constraint).toBe('invalid_format'); 
    });

    it('should validate maxCount constraint', () => {
      const shape = {
        uri: 'https://example.org/UserShape',
        targetClass: 'https://schema.org/Person',
        properties: [
          {
            path: 'https://schema.org/name',
            name: 'name',
            datatype: XSD.STRING, // Add datatype so it's not z.any()
            maxCount: 1,
          },
        ],
      };

      // Too many values
      const result = manager.validate(
        { name: ['Alice', 'Bob'] },
        shape
      );
      
      // Zod rejects array when string is expected
      expect(result.valid).toBe(false);
      expect(result.errors![0].constraint).toBe('invalid_type'); 
    });
  });
});
