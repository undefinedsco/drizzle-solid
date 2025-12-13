/**
 * SHACL Shape 解析器
 * 
 * 从 Turtle 格式的 SHACL 定义解析出 Shape 对象
 */

import { Parser, Store, NamedNode, BlankNode, Literal } from 'n3';
import { Shape, ShapeProperty, SHACL, XSD } from './types';

/**
 * 从 Turtle 内容解析 SHACL Shape
 */
export async function parseSHACL(turtle: string, baseUri?: string): Promise<Shape[]> {
  const store = new Store();
  const parser = new Parser({ baseIRI: baseUri });
  
  return new Promise((resolve, reject) => {
    const quads: any[] = [];
    
    parser.parse(turtle, (error, quad, prefixes) => {
      if (error) {
        reject(error);
        return;
      }
      
      if (quad) {
        quads.push(quad);
      } else {
        // Parsing complete
        store.addQuads(quads);
        try {
          const shapes = extractShapes(store);
          resolve(shapes);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

/**
 * 从 RDF Store 提取所有 Shape
 */
function extractShapes(store: Store): Shape[] {
  const shapes: Shape[] = [];
  
  // 查找所有 sh:NodeShape
  const nodeShapeQuads = store.getQuads(
    null,
    new NamedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    new NamedNode(SHACL.NODE_SHAPE),
    null
  );
  
  for (const quad of nodeShapeQuads) {
    const shapeSubject = quad.subject;
    // 只处理 NamedNode 和 BlankNode，跳过 Variable
    if (shapeSubject.termType === 'NamedNode' || shapeSubject.termType === 'BlankNode') {
      const shape = extractShape(store, shapeSubject as NamedNode | BlankNode);
      if (shape) {
        shapes.push(shape);
      }
    }
  }
  
  return shapes;
}

/**
 * 提取单个 Shape
 */
function extractShape(store: Store, shapeNode: NamedNode | BlankNode): Shape | null {
  // 获取 targetClass
  const targetClassQuads = store.getQuads(shapeNode, new NamedNode(SHACL.TARGET_CLASS), null, null);
  if (targetClassQuads.length === 0) {
    return null; // 没有 targetClass，跳过
  }
  
  const targetClass = targetClassQuads[0].object.value;
  
  // 获取 name
  const nameQuads = store.getQuads(shapeNode, new NamedNode(SHACL.NAME), null, null);
  const name = nameQuads.length > 0 ? nameQuads[0].object.value : undefined;
  
  // 获取 description
  const descQuads = store.getQuads(shapeNode, new NamedNode(SHACL.DESCRIPTION), null, null);
  const description = descQuads.length > 0 ? descQuads[0].object.value : undefined;
  
  // 获取 properties
  const propertyQuads = store.getQuads(shapeNode, new NamedNode(SHACL.PROPERTY), null, null);
  const properties: ShapeProperty[] = [];
  
  for (const propQuad of propertyQuads) {
    const propNode = propQuad.object;
    const property = extractProperty(store, propNode as NamedNode | BlankNode);
    if (property) {
      properties.push(property);
    }
  }
  
  return {
    uri: shapeNode.value,
    targetClass,
    name,
    description,
    properties
  };
}

/**
 * 提取单个属性约束
 */
function extractProperty(store: Store, propNode: NamedNode | BlankNode): ShapeProperty | null {
  // 获取 path
  const pathQuads = store.getQuads(propNode, new NamedNode(SHACL.PATH), null, null);
  if (pathQuads.length === 0) {
    return null;
  }
  
  let path: string;
  let inverse = false;
  
  const pathObject = pathQuads[0].object;
  
  // 检查是否是 inversePath
  if (pathObject.termType === 'BlankNode') {
    const inverseQuads = store.getQuads(pathObject as BlankNode, new NamedNode(SHACL.INVERSE_PATH), null, null);
    if (inverseQuads.length > 0) {
      path = inverseQuads[0].object.value;
      inverse = true;
    } else {
      // 其他复杂路径，暂不支持
      return null;
    }
  } else {
    path = pathObject.value;
  }
  
  // 获取 name
  const nameQuads = store.getQuads(propNode, new NamedNode(SHACL.NAME), null, null);
  const name = nameQuads.length > 0 ? nameQuads[0].object.value : extractNameFromPath(path);
  
  // 获取 datatype
  const datatypeQuads = store.getQuads(propNode, new NamedNode(SHACL.DATATYPE), null, null);
  const datatype = datatypeQuads.length > 0 ? datatypeQuads[0].object.value : undefined;
  
  // 获取 nodeKind
  const nodeKindQuads = store.getQuads(propNode, new NamedNode(SHACL.NODE_KIND), null, null);
  const nodeKind = nodeKindQuads.length > 0 ? nodeKindQuads[0].object.value : undefined;
  
  // 获取 minCount
  const minCountQuads = store.getQuads(propNode, new NamedNode(SHACL.MIN_COUNT), null, null);
  const minCount = minCountQuads.length > 0 ? parseInt(minCountQuads[0].object.value, 10) : undefined;
  
  // 获取 maxCount
  const maxCountQuads = store.getQuads(propNode, new NamedNode(SHACL.MAX_COUNT), null, null);
  const maxCount = maxCountQuads.length > 0 ? parseInt(maxCountQuads[0].object.value, 10) : undefined;
  
  // 获取 pattern
  const patternQuads = store.getQuads(propNode, new NamedNode(SHACL.PATTERN), null, null);
  const pattern = patternQuads.length > 0 ? patternQuads[0].object.value : undefined;
  
  // 获取 class
  const classQuads = store.getQuads(propNode, new NamedNode(SHACL.CLASS), null, null);
  const classUri = classQuads.length > 0 ? classQuads[0].object.value : undefined;
  
  return {
    path,
    name,
    datatype,
    nodeKind,
    minCount,
    maxCount,
    pattern,
    class: classUri,
    inverse
  };
}

/**
 * 从 path URI 提取属性名
 * 例如：http://schema.org/name -> name
 */
function extractNameFromPath(path: string): string {
  // 尝试从 # 后面提取
  const hashIndex = path.lastIndexOf('#');
  if (hashIndex >= 0) {
    return path.substring(hashIndex + 1);
  }
  
  // 尝试从最后一个 / 后面提取
  const slashIndex = path.lastIndexOf('/');
  if (slashIndex >= 0) {
    return path.substring(slashIndex + 1);
  }
  
  return path;
}

/**
 * XSD 类型到 Drizzle-Solid 类型的映射
 */
export function xsdToDrizzleType(xsdType: string | undefined): string {
  if (!xsdType) return 'string';
  
  switch (xsdType) {
    case XSD.STRING:
      return 'string';
    case XSD.INTEGER:
      return 'integer';
    case XSD.BOOLEAN:
      return 'boolean';
    case XSD.DATETIME:
    case XSD.DATE:
      return 'datetime';
    case XSD.DECIMAL:
    case XSD.DOUBLE:
      return 'number';
    case XSD.ANYURI:
      return 'uri';
    default:
      return 'string';
  }
}

/**
 * 从 nodeKind 推断类型
 */
export function nodeKindToDrizzleType(nodeKind: string | undefined): string | undefined {
  if (!nodeKind) return undefined;
  
  switch (nodeKind) {
    case SHACL.IRI:
      return 'uri';
    case SHACL.LITERAL:
      return 'string';
    case SHACL.BLANK_NODE:
      return 'object';
    default:
      return undefined;
  }
}
