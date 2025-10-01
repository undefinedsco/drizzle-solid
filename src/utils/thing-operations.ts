// 简化的 Thing 操作工具，避免复杂的 @inrupt/solid-client 类型问题

export interface ThingData {
  [key: string]: string | number | Date | string[] | undefined;
}

/**
 * 创建一个新的 Thing
 */
export async function createThing(
  containerUrl: string,
  thingUrl: string,
  data: ThingData,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<string> {
  try {
    // 将数据转换为 Turtle 格式
    const turtleData = convertToTurtle(thingUrl, data);
    
    // 发送 POST 请求创建资源
    const response = await fetchFn(containerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/turtle',
        'Link': '<http://www.w3.org/ns/ldp#Resource>; rel="type"'
      },
      body: turtleData
    });

    if (!response.ok) {
      throw new Error(`Failed to create Thing: ${response.statusText}`);
    }

    return thingUrl;
  } catch (error) {
    console.error('Error creating Thing:', error);
    throw error;
  }
}

/**
 * 读取一个 Thing
 */
export async function readThing(
  resourceUrl: string,
  thingUrl: string,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<ThingData | null> {
  try {
    // 发送 GET 请求获取资源
    const response = await fetchFn(resourceUrl, {
      headers: {
        'Accept': 'text/turtle, application/ld+json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to read Thing: ${response.statusText}`);
    }

    const data = await response.text();
    
    // 解析 Turtle 数据
    return parseTurtleData(data, thingUrl);
  } catch (error) {
    console.error('Error reading Thing:', error);
    return null;
  }
}

/**
 * 更新一个 Thing
 */
export async function updateThing(
  resourceUrl: string,
  thingUrl: string,
  data: ThingData,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<boolean> {
  try {
    // 将数据转换为 Turtle 格式
    const turtleData = convertToTurtle(thingUrl, data);
    
    // 发送 PUT 请求更新资源
    const response = await fetchFn(resourceUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle'
      },
      body: turtleData
    });

    if (!response.ok) {
      throw new Error(`Failed to update Thing: ${response.statusText}`);
    }

    return true;
  } catch (error) {
    console.error('Error updating Thing:', error);
    return false;
  }
}

/**
 * 删除一个 Thing
 */
export async function deleteThing(
  resourceUrl: string,
  thingUrl: string,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<boolean> {
  try {
    // 发送 DELETE 请求删除资源
    const response = await fetchFn(resourceUrl, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error(`Failed to delete Thing: ${response.statusText}`);
    }

    return true;
  } catch (error) {
    console.error('Error deleting Thing:', error);
    return false;
  }
}

/**
 * 批量操作 Things
 */
export async function batchThingOperations(
  resourceUrl: string,
  operations: Array<{
    type: 'create' | 'update' | 'delete';
    thingUrl: string;
    data?: ThingData;
  }>,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<boolean> {
  try {
    // 简化实现：逐个执行操作
    for (const operation of operations) {
      switch (operation.type) {
        case 'create':
          if (operation.data) {
            await createThing(resourceUrl, operation.thingUrl, operation.data, fetchFn);
          }
          break;
          
        case 'update':
          if (operation.data) {
            await updateThing(resourceUrl, operation.thingUrl, operation.data, fetchFn);
          }
          break;
          
        case 'delete':
          await deleteThing(resourceUrl, operation.thingUrl, fetchFn);
          break;
      }
    }

    return true;
  } catch (error) {
    console.error('Error in batch Thing operations:', error);
    return false;
  }
}

// 辅助函数：将数据转换为 Turtle 格式
function convertToTurtle(thingUrl: string, data: ThingData): string {
  const subject = `<${thingUrl}>`;
  let turtle = '@prefix : <#> .\n@prefix foaf: <http://xmlns.com/foaf/0.1/> .\n@prefix schema: <https://schema.org/> .\n@prefix dc: <http://purl.org/dc/terms/> .\n\n';
  
  for (const [predicate, value] of Object.entries(data)) {
    if (value === undefined) continue;
    
    let predicateUri = predicate;
    if (!predicate.startsWith('http')) {
      // 简单的前缀扩展
      if (predicate.startsWith('foaf:')) {
        predicateUri = predicate;
      } else if (predicate.startsWith('schema:')) {
        predicateUri = predicate;
      } else if (predicate.startsWith('dc:')) {
        predicateUri = predicate;
      } else {
        predicateUri = `:${predicate}`;
      }
    } else {
      predicateUri = `<${predicate}>`;
    }
    
    if (Array.isArray(value)) {
      for (const item of value) {
        turtle += `${subject} ${predicateUri} "${escapeString(String(item))}" .\n`;
      }
    } else if (typeof value === 'string') {
      turtle += `${subject} ${predicateUri} "${escapeString(value)}" .\n`;
    } else if (typeof value === 'number') {
      turtle += `${subject} ${predicateUri} ${value} .\n`;
    } else if (value instanceof Date) {
      turtle += `${subject} ${predicateUri} "${value.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n`;
    }
  }
  
  return turtle;
}

// 辅助函数：解析 Turtle 数据
function parseTurtleData(turtle: string, thingUrl: string): ThingData {
  const data: ThingData = {};
  const lines = turtle.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) {
      continue;
    }
    
    // 简单的三元组解析
    const match = trimmed.match(/^(<[^>]+>|\w+:\w+)\s+(<[^>]+>|\w+:\w+)\s+(.+?)\s*\.?$/);
    if (match) {
      const [, subject, predicate, object] = match;
      
      // 检查是否是我们要找的 Thing
      const cleanSubject = subject.replace(/^<|>$/g, '');
      if (cleanSubject === thingUrl) {
        const cleanPredicate = predicate.replace(/^<|>$/g, '');
        const cleanObject = parseObjectValue(object);
        
        // 简化谓词名称
        const simplePredicate = getSimplePredicateName(cleanPredicate);
        
        if (data[simplePredicate]) {
          // 如果已存在，转换为数组
          if (!Array.isArray(data[simplePredicate])) {
            data[simplePredicate] = [data[simplePredicate] as string];
          }
          (data[simplePredicate] as string[]).push(cleanObject as string);
        } else {
          data[simplePredicate] = cleanObject;
        }
      }
    }
  }
  
  return data;
}

// 辅助函数：转义字符串
function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// 辅助函数：解析对象值
function parseObjectValue(object: string): string | number | Date {
  // 移除引号
  if (object.startsWith('"') && object.includes('"')) {
    const endQuote = object.lastIndexOf('"');
    const value = object.substring(1, endQuote);
    
    // 检查数据类型
    if (object.includes('^^<http://www.w3.org/2001/XMLSchema#dateTime>')) {
      return new Date(value);
    } else if (object.includes('^^<http://www.w3.org/2001/XMLSchema#integer>')) {
      return parseInt(value, 10);
    } else if (object.includes('^^<http://www.w3.org/2001/XMLSchema#decimal>')) {
      return parseFloat(value);
    }
    
    return value;
  }
  
  // 数字
  const num = Number(object);
  if (!isNaN(num)) {
    return num;
  }
  
  // URI
  if (object.startsWith('<') && object.endsWith('>')) {
    return object.slice(1, -1);
  }
  
  return object;
}

// 辅助函数：获取简化的谓词名称
function getSimplePredicateName(predicate: string): string {
  if (predicate.includes('#')) {
    return predicate.split('#').pop() || predicate;
  }
  if (predicate.includes('/')) {
    return predicate.split('/').pop() || predicate;
  }
  return predicate;
}