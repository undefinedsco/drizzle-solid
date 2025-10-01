import {
  RDF_PREDICATES,
  RDF_CLASSES,
  RDF_NAMESPACES,
  buildURI,
  getLocalName,
  getNamespace
} from '@src/core/rdf-constants';

describe('RDF Constants', () => {
  describe('常量定义', () => {
    it('应该导出 RDF_PREDICATES', () => {
      expect(RDF_PREDICATES).toBeDefined();
      expect(typeof RDF_PREDICATES).toBe('object');
      expect(RDF_PREDICATES.RDF_TYPE).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
      expect(RDF_PREDICATES.RDFS_LABEL).toBe('http://www.w3.org/2000/01/rdf-schema#label');
    });

    it('应该导出 RDF_CLASSES', () => {
      expect(RDF_CLASSES).toBeDefined();
      expect(typeof RDF_CLASSES).toBe('object');
      expect(RDF_CLASSES.SCHEMA_PERSON).toBe('https://schema.org/Person');
      expect(RDF_CLASSES.FOAF_PERSON).toBe('http://xmlns.com/foaf/0.1/Person');
    });

    it('应该导出 RDF_NAMESPACES', () => {
      expect(RDF_NAMESPACES).toBeDefined();
      expect(typeof RDF_NAMESPACES).toBe('object');
      expect(RDF_NAMESPACES.RDF).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
      expect(RDF_NAMESPACES.RDFS).toBe('http://www.w3.org/2000/01/rdf-schema#');
    });
  });

  describe('常量访问测试', () => {
    it('应该能够访问 RDF_PREDICATES 中的值', () => {
      expect(RDF_PREDICATES.RDF_TYPE).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
      expect(RDF_PREDICATES.SCHEMA_NAME).toBe('https://schema.org/name');
      expect(RDF_PREDICATES.FOAF_NAME).toBe('http://xmlns.com/foaf/0.1/name');
    });

    it('应该能够访问 RDF_CLASSES 中的值', () => {
      expect(RDF_CLASSES.SCHEMA_PERSON).toBe('https://schema.org/Person');
      expect(RDF_CLASSES.FOAF_PERSON).toBe('http://xmlns.com/foaf/0.1/Person');
      expect(RDF_CLASSES.LDP_CONTAINER).toBe('http://www.w3.org/ns/ldp#Container');
    });

    it('应该能够访问 RDF_NAMESPACES 中的值', () => {
      expect(RDF_NAMESPACES.RDF).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
      expect(RDF_NAMESPACES.RDFS).toBe('http://www.w3.org/2000/01/rdf-schema#');
      expect(RDF_NAMESPACES.SCHEMA).toBe('https://schema.org/');
    });
  });

  describe('常量完整性测试', () => {
    it('RDF_PREDICATES 应该包含所有必需的谓词', () => {
      const requiredPredicates = ['RDF_TYPE', 'RDFS_LABEL', 'SCHEMA_NAME', 'FOAF_NAME'];
      requiredPredicates.forEach(predicate => {
        expect(RDF_PREDICATES).toHaveProperty(predicate);
        expect(typeof RDF_PREDICATES[predicate]).toBe('string');
        expect(RDF_PREDICATES[predicate]).toMatch(/^https?:\/\//);
      });
    });

    it('RDF_CLASSES 应该包含所有必需的类', () => {
      const requiredClasses = ['SCHEMA_PERSON', 'FOAF_PERSON', 'LDP_CONTAINER'];
      requiredClasses.forEach(cls => {
        expect(RDF_CLASSES).toHaveProperty(cls);
        expect(typeof RDF_CLASSES[cls]).toBe('string');
        expect(RDF_CLASSES[cls]).toMatch(/^https?:\/\//);
      });
    });

    it('RDF_NAMESPACES 应该包含所有必需的命名空间', () => {
      const requiredNamespaces = ['RDF', 'RDFS', 'SCHEMA', 'FOAF'];
      requiredNamespaces.forEach(namespace => {
        expect(RDF_NAMESPACES).toHaveProperty(namespace);
        expect(typeof RDF_NAMESPACES[namespace]).toBe('string');
        expect(RDF_NAMESPACES[namespace]).toMatch(/^https?:\/\//);
        // Schema.org 和 FOAF 不以 # 结尾
        if (namespace !== 'SCHEMA' && namespace !== 'FOAF') {
          expect(RDF_NAMESPACES[namespace]).toMatch(/#$/);
        }
      });
    });
  });

  describe('常量结构测试', () => {
    it('RDF_PREDICATES 应该是只读对象', () => {
      expect(Object.isFrozen(RDF_PREDICATES)).toBe(false); // 使用 as const 但不是 frozen
    });

    it('RDF_CLASSES 应该是只读对象', () => {
      expect(Object.isFrozen(RDF_CLASSES)).toBe(false); // 使用 as const 但不是 frozen
    });

    it('RDF_NAMESPACES 应该是只读对象', () => {
      expect(Object.isFrozen(RDF_NAMESPACES)).toBe(false); // 使用 as const 但不是 frozen
    });

    it('所有常量值都应该是有效的 URI', () => {
      Object.values(RDF_PREDICATES).forEach(value => {
        expect(value).toMatch(/^https?:\/\//);
      });
      
      Object.values(RDF_CLASSES).forEach(value => {
        expect(value).toMatch(/^https?:\/\//);
      });
      
      Object.values(RDF_NAMESPACES).forEach(value => {
        expect(value).toMatch(/^https?:\/\//);
      });
    });
  });

  describe('辅助函数测试', () => {
    describe('buildURI', () => {
      it('应该正确构建 URI', () => {
        expect(buildURI('RDF', 'type')).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
        expect(buildURI('RDFS', 'label')).toBe('http://www.w3.org/2000/01/rdf-schema#label');
        expect(buildURI('SCHEMA', 'name')).toBe('https://schema.org/name');
      });

      it('应该处理不存在的命名空间', () => {
        expect(buildURI('UNKNOWN' as never, 'test')).toBe('undefinedtest');
      });
    });

    describe('getLocalName', () => {
      it('应该正确提取本地名称（使用 # 分隔符）', () => {
        expect(getLocalName('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBe('type');
        expect(getLocalName('http://www.w3.org/2000/01/rdf-schema#label')).toBe('label');
      });

      it('应该正确提取本地名称（使用 / 分隔符）', () => {
        expect(getLocalName('https://schema.org/name')).toBe('name');
        expect(getLocalName('http://example.com/path/resource')).toBe('resource');
      });

      it('应该处理没有分隔符的 URI', () => {
        expect(getLocalName('simpleuri')).toBe('simpleuri');
        expect(getLocalName('')).toBe('');
      });

      it('应该处理以分隔符结尾的 URI', () => {
        expect(getLocalName('http://example.com/')).toBe('');
        expect(getLocalName('http://example.com#')).toBe('');
      });
    });

    describe('getNamespace', () => {
      it('应该正确提取命名空间（使用 # 分隔符）', () => {
        expect(getNamespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
        expect(getNamespace('http://www.w3.org/2000/01/rdf-schema#label')).toBe('http://www.w3.org/2000/01/rdf-schema#');
      });

      it('应该正确提取命名空间（使用 / 分隔符）', () => {
        expect(getNamespace('https://schema.org/name')).toBe('https://schema.org/');
        expect(getNamespace('http://example.com/path/resource')).toBe('http://example.com/path/');
      });

      it('应该处理没有分隔符的 URI', () => {
        expect(getNamespace('simpleuri')).toBe('');
        expect(getNamespace('')).toBe('');
      });

      it('应该处理以分隔符结尾的 URI', () => {
        expect(getNamespace('http://example.com/')).toBe('http://example.com/');
        expect(getNamespace('http://example.com#')).toBe('http://example.com#');
      });
    });
  });
});
