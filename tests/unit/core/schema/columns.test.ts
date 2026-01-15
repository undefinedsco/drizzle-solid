/**
 * Column Builder Unit Tests
 * 
 * Tests for src/core/schema/columns.ts
 */

import { describe, it, expect } from 'vitest';
import { 
  string, 
  int, 
  boolean, 
  id, 
  uri,
  ColumnBuilder,
  PodStringColumn 
} from '../../../../src/core/schema';

describe('ColumnBuilder', () => {
  describe('primaryKey()', () => {
    it('should set predicate to @id', () => {
      const col = string('myId').primaryKey();
      expect(col.options.predicate).toBe('@id');
      expect(col.options.primaryKey).toBe(true);
      expect(col.options.required).toBe(true);
    });

    it('should set predicate to @id regardless of column name', () => {
      const col1 = string('id').primaryKey();
      const col2 = string('userId').primaryKey();
      const col3 = string('providerId').primaryKey();

      expect(col1.options.predicate).toBe('@id');
      expect(col2.options.predicate).toBe('@id');
      expect(col3.options.predicate).toBe('@id');
    });

    it('should work with chained methods', () => {
      const col = string('id').primaryKey().notNull();
      expect(col.options.predicate).toBe('@id');
      expect(col.options.primaryKey).toBe(true);
      expect(col.options.required).toBe(true);
      expect(col.options.notNull).toBe(true);
    });

    it('should work with int columns', () => {
      const col = int('numericId').primaryKey();
      expect(col.options.predicate).toBe('@id');
      expect(col.options.primaryKey).toBe(true);
    });
  });

  describe('id() vs string().primaryKey() equivalence', () => {
    it('should produce equivalent predicate configuration', () => {
      const idCol = id('id');
      const stringCol = string('id').primaryKey();

      expect(idCol.options.predicate).toBe('@id');
      expect(stringCol.options.predicate).toBe('@id');

      expect(idCol.options.primaryKey).toBe(true);
      expect(stringCol.options.primaryKey).toBe(true);
      expect(idCol.options.required).toBe(true);
      expect(stringCol.options.required).toBe(true);
    });

    it('id() should have defaultValue generator', () => {
      const idCol = id('id');
      expect(idCol.options.defaultValue).toBeDefined();
      expect(typeof idCol.options.defaultValue).toBe('function');
    });
  });

  describe('predicate()', () => {
    it('should set custom predicate URI', () => {
      const col = string('name').predicate('https://schema.org/name');
      expect(col.options.predicate).toBe('https://schema.org/name');
    });

    it('should override predicate when called after primaryKey', () => {
      // Note: This is an edge case - calling predicate() after primaryKey()
      // will override the @id predicate
      const col = string('id').primaryKey().predicate('https://custom.org/id');
      expect(col.options.predicate).toBe('https://custom.org/id');
    });
  });

  describe('notNull()', () => {
    it('should set required and notNull flags', () => {
      const col = string('name').notNull();
      expect(col.options.required).toBe(true);
      expect(col.options.notNull).toBe(true);
    });
  });

  describe('default()', () => {
    it('should set static default value', () => {
      const col = string('status').default('active');
      expect(col.options.defaultValue).toBe('active');
    });

    it('should set function default value', () => {
      const generator = () => 'generated';
      const col = string('code').default(generator);
      expect(col.options.defaultValue).toBe(generator);
    });
  });

  describe('array()', () => {
    it('should create array column', () => {
      const col = string('tags').array();
      expect(col.dataType).toBe('array');
      expect(col.options.isArray).toBe(true);
      expect(col.options.baseType).toBe('string');
    });

    it('should preserve predicate in array column', () => {
      const col = string('tags').predicate('https://schema.org/keywords').array();
      expect(col.options.predicate).toBe('https://schema.org/keywords');
      expect(col.options.isArray).toBe(true);
    });
  });

  describe('reference()', () => {
    it('should set reference target URL', () => {
      const col = uri('author').reference('https://schema.org/Person');
      expect(col.options.referenceTarget).toBe('https://schema.org/Person');
    });

    it('should set reference table name', () => {
      const col = uri('author').reference('users');
      expect(col.options.referenceTableName).toBe('users');
    });
  });

  describe('inverse()', () => {
    it('should set inverse flag', () => {
      const col = uri('followers').inverse();
      expect(col.options.inverse).toBe(true);
    });

    it('should accept explicit false', () => {
      const col = uri('followers').inverse(false);
      expect(col.options.inverse).toBe(false);
    });
  });
});

describe('PodColumnBase', () => {
  describe('primaryKey()', () => {
    it('should set predicate to @id on PodStringColumn', () => {
      const col = new PodStringColumn('id');
      col.primaryKey();
      expect(col.options.predicate).toBe('@id');
      expect(col.options.primaryKey).toBe(true);
      expect(col.options.required).toBe(true);
    });
  });
});
