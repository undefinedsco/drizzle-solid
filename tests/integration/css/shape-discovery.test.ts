import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle } from '../../../src/driver';
import type { SolidDatabase } from '../../../src/driver';
import type { Session } from '@inrupt/solid-client-authn-node';
import { createTestSession, ensureContainer } from './helpers';
import { podTable, string, int, boolean, uri, id } from '../../../src/core/pod-table';
import { INTEROP } from '../../../src/core/discovery/interop-types';

const containerPath = `/shape-discovery-test/${Date.now()}/`;
const nextRequestId = (prefix: string) => `${prefix}-${Date.now()}`;

vi.setConfig({ testTimeout: 120_000 });

describe('CSS integration: Shape Discovery and Table Generation', () => {
  let session: Session;
  let db: SolidDatabase;
  let containerUrl: string;
  let podBase: string;

  beforeAll(async () => {
    session = await createTestSession();
    db = drizzle(session);
    containerUrl = await ensureContainer(session, containerPath);
    podBase = containerUrl.replace(containerPath.slice(1), '');
    console.log('[Shape Discovery Test] Container URL:', containerUrl);
    console.log('[Shape Discovery Test] Pod Base:', podBase);
  }, 120_000);

  afterAll(async () => {
    await db.disconnect();
  });

  describe('ShapeManager', () => {
    test('should load and parse SHACL shape from URL', async () => {
      const shapeManager = db.getDialect().getShapeManager();
      
      // Create a mock shape resource in the pod
      const shapeUrl = `${containerUrl}shapes/person.shacl`;
      const shapeTurtle = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix schema: <http://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<#PersonShape>
    a sh:NodeShape ;
    sh:targetClass schema:Person ;
    sh:property [
        sh:path schema:name ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
    ] ;
    sh:property [
        sh:path schema:email ;
        sh:datatype xsd:string ;
    ] ;
    sh:property [
        sh:path schema:age ;
        sh:datatype xsd:integer ;
    ] .
`;

      // Ensure shapes container exists
      await ensureContainer(session, `${containerPath}shapes`);
      
      // Upload the shape file
      const putResponse = await session.fetch(shapeUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'X-Request-ID': nextRequestId('shape-put'),
        },
        body: shapeTurtle
      });
      expect(putResponse.ok).toBe(true);

      // Load the shape using ShapeManager
      const shape = await shapeManager.loadShape(shapeUrl);
      
      expect(shape).not.toBeNull();
      expect(shape!.targetClass).toBe('http://schema.org/Person');
      expect(shape!.properties.length).toBeGreaterThanOrEqual(3);
      
      // Verify properties
      const nameProp = shape!.properties.find(p => p.path === 'http://schema.org/name');
      expect(nameProp).toBeDefined();
      expect(nameProp!.datatype).toBe('http://www.w3.org/2001/XMLSchema#string');
      expect(nameProp!.minCount).toBe(1);
      
      const ageProp = shape!.properties.find(p => p.path === 'http://schema.org/age');
      expect(ageProp).toBeDefined();
      expect(ageProp!.datatype).toBe('http://www.w3.org/2001/XMLSchema#integer');
    });

    test('should generate PodTable from Shape', async () => {
      const shapeManager = db.getDialect().getShapeManager();
      
      // Create a shape manually for testing
      const testShape = {
        uri: 'http://example.org/shapes#TestShape',
        targetClass: 'http://example.org/TestClass',
        properties: [
          {
            path: 'http://schema.org/name',
            datatype: 'http://www.w3.org/2001/XMLSchema#string',
            minCount: 1,
            maxCount: 1
          },
          {
            path: 'http://schema.org/count',
            datatype: 'http://www.w3.org/2001/XMLSchema#integer',
            minCount: 0,
            maxCount: 1
          },
          {
            path: 'http://schema.org/active',
            datatype: 'http://www.w3.org/2001/XMLSchema#boolean',
            minCount: 0,
            maxCount: 1
          }
        ]
      };

      const generated = shapeManager.shapeToTable(testShape, containerUrl);
      
      expect(generated.name).toBe('testclass');
      expect(generated.table).toBeDefined();
      expect(generated.shape).toBe(testShape);
      
      // Verify the table has correct columns
      const columns = generated.table.columns;
      expect(columns.id).toBeDefined();
      expect(columns.name).toBeDefined();
      expect(columns.count).toBeDefined();
      expect(columns.active).toBeDefined();
    });

    test('should handle extended shapes with app-specific properties', async () => {
      const shapeManager = db.getDialect().getShapeManager();
      
      // Create an extended shape that adds app-specific fields to schema:Person
      const shapeUrl = `${containerUrl}shapes/extended-person.shacl`;
      const shapeTurtle = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix schema: <http://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix myapp: <http://myapp.example.org/> .

<#ExtendedPersonShape>
    a sh:NodeShape ;
    sh:targetClass schema:Person ;
    # Standard schema.org properties
    sh:property [
        sh:path schema:name ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
    ] ;
    sh:property [
        sh:path schema:email ;
        sh:datatype xsd:string ;
    ] ;
    # App-specific extensions
    sh:property [
        sh:path myapp:loyaltyPoints ;
        sh:datatype xsd:integer ;
    ] ;
    sh:property [
        sh:path myapp:memberSince ;
        sh:datatype xsd:dateTime ;
    ] ;
    sh:property [
        sh:path myapp:preferredStore ;
        sh:nodeKind sh:IRI ;
    ] .
`;

      // Upload the extended shape
      const putResponse = await session.fetch(shapeUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'X-Request-ID': nextRequestId('shape-put'),
        },
        body: shapeTurtle
      });
      expect(putResponse.ok).toBe(true);

      // Load and verify the extended shape
      const shape = await shapeManager.loadShape(shapeUrl);
      
      expect(shape).not.toBeNull();
      expect(shape!.targetClass).toBe('http://schema.org/Person');
      
      // Should have both standard and app-specific properties
      const propPaths = shape!.properties.map(p => p.path);
      expect(propPaths).toContain('http://schema.org/name');
      expect(propPaths).toContain('http://schema.org/email');
      expect(propPaths).toContain('http://myapp.example.org/loyaltyPoints');
      expect(propPaths).toContain('http://myapp.example.org/memberSince');
      expect(propPaths).toContain('http://myapp.example.org/preferredStore');
      
      // Generate table from extended shape
      const generated = shapeManager.shapeToTable(shape!, containerUrl);
      
      // Verify app-specific columns are present
      const columns = generated.table.columns;
      expect(columns.loyaltypoints || columns.loyaltyPoints).toBeDefined();
      expect(columns.membersince || columns.memberSince).toBeDefined();
      expect(columns.preferredstore || columns.preferredStore).toBeDefined();
    });
  });

  describe('discoverTable integration', () => {
    const testType = `http://example.org/TestType_${Date.now()}`;
    const dataContainerPath = `${containerPath}data/`;
    
    beforeAll(async () => {
      // Setup: Create TypeIndex registration for the test type
      await ensureContainer(session, dataContainerPath);
    });

    test('should discover table via TypeIndex and generate from Shape', async () => {
      // 1. Create a Shape for the test type
      const shapeUrl = `${containerUrl}shapes/test-type.shacl`;
      const shapeTurtle = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix ex: <http://example.org/> .

<#TestTypeShape>
    a sh:NodeShape ;
    sh:targetClass <${testType}> ;
    sh:property [
        sh:path ex:title ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
    ] ;
    sh:property [
        sh:path ex:priority ;
        sh:datatype xsd:integer ;
    ] .
`;
      
      const shapePut = await session.fetch(shapeUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'X-Request-ID': nextRequestId('shape-put'),
        },
        body: shapeTurtle
      });
      expect(shapePut.ok).toBe(true);

      // 2. Create a predefined table with typeIndex registration
      // This simulates what a real app would do
      const testTable = podTable('test_discover', {
        id: id(),
        title: string('title').predicate('http://example.org/title'),
        priority: int('priority').predicate('http://example.org/priority')
      }, {
        type: testType,
        containerPath: `${containerUrl}data/`,
        typeIndex: 'private'
      });

      await db.init(testTable);
      
      // Insert some test data
      await db.insert(testTable).values({
        title: 'Test Item',
        priority: 5
      });

      // 3. Now try to discover this type
      // Note: discoverTable relies on TypeIndex/Interop registration
      const dialect = db.getDialect();
      const locations = await dialect.discoverDataLocations(testType);
      
      console.log('[discoverTable test] Discovered locations:', locations);
      
      // Verify at least one location was discovered
      expect(locations.length).toBeGreaterThan(0);
      expect(locations[0].container).toContain('data');
    });

    test('should return null for unregistered types', async () => {
      const unknownType = `http://example.org/UnknownType_${Date.now()}`;
      
      const table = await db.discoverTable(unknownType);
      
      expect(table).toBeNull();
    });
  });

  describe('Full discovery workflow', () => {
    test('should discover, load shape, generate table, and query data', async () => {
      const testType = `http://schema.org/Product_${Date.now()}`;
      const productsPath = `${containerPath}products/`;
      
      // 1. Create container and shape
      await ensureContainer(session, productsPath);
      
      const shapeUrl = `${containerUrl}shapes/product.shacl`;
      const shapeTurtle = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix schema: <http://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<#ProductShape>
    a sh:NodeShape ;
    sh:targetClass <${testType}> ;
    sh:property [
        sh:path schema:name ;
        sh:datatype xsd:string ;
        sh:minCount 1 ;
    ] ;
    sh:property [
        sh:path schema:price ;
        sh:datatype xsd:decimal ;
    ] ;
    sh:property [
        sh:path schema:inStock ;
        sh:datatype xsd:boolean ;
    ] .
`;
      
      await session.fetch(shapeUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'X-Request-ID': nextRequestId('shape-put'),
        },
        body: shapeTurtle
      });

      // 2. Create initial data using predefined table
      const productTable = podTable('products', {
        id: id(),
        name: string('name').predicate('http://schema.org/name'),
        price: string('price').predicate('http://schema.org/price'),
        inStock: boolean('inStock').predicate('http://schema.org/inStock')
      }, {
        type: testType,
        containerPath: productsPath,
        typeIndex: 'private'
      });

      await db.init(productTable);
      
      // Insert test products
      await db.insert(productTable).values([
        { name: 'Widget A', price: '19.99', inStock: true },
        { name: 'Widget B', price: '29.99', inStock: false }
      ]);

      // 3. Verify data can be queried via the predefined table
      const results = await db.select().from(productTable);
      
      expect(results.length).toBe(2);
      expect(results.some((r: any) => r.name === 'Widget A')).toBe(true);
      expect(results.some((r: any) => r.name === 'Widget B')).toBe(true);
      
      // 4. Test ShapeManager.shapeToTable produces usable table
      const shapeManager = db.getDialect().getShapeManager();
      const shape = await shapeManager.loadShape(shapeUrl);
      
      expect(shape).not.toBeNull();
      
      const generated = shapeManager.shapeToTable(shape!, productsPath);
      expect(generated.table).toBeDefined();
      
      // The generated table should be usable for queries (after init)
      // Note: In practice you'd use discoverTable which does init automatically
    });
  });
});
