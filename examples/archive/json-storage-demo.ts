import { podTable, string, int, json, object, date, COMMON_NAMESPACES, RDF_CLASSES } from '../src/index';

// 演示 JSON 和 Object 类型在 Solid Pod 中的存储
const users = podTable('users', {
  id: int('id').primaryKey(),
  name: string('name').notNull(),
  email: string('email').notNull(),
  // JSON 类型 - 存储用户偏好设置
  preferences: json('preferences'),
  // Object 类型 - 存储用户档案信息
  profile: object('profile'),
  createdAt: date('createdAt'),
}, {
  containerPath: '/users/',
  rdfClass: RDF_CLASSES.SCHEMA_PERSON,
  namespace: COMMON_NAMESPACES.schema
});

function demonstrateJsonStorage() {
  console.log('=== JSON 和 Object 类型在 Solid Pod 中的存储演示 ===\n');
  
  // 示例数据
  const userData = {
    name: 'Alice Johnson',
    email: 'alice@example.com',
    preferences: {
      theme: 'dark',
      language: 'zh-CN',
      notifications: {
        email: true,
        push: false,
        sms: true
      }
    },
    profile: {
      age: 28,
      city: 'Beijing',
      occupation: 'Software Engineer',
      skills: ['TypeScript', 'React', 'Node.js']
    }
  };
  
  console.log('1. 原始 JavaScript 数据:');
  console.log(JSON.stringify(userData, null, 2));
  
  console.log('\n2. 在 Solid Pod 中存储为 RDF 三元组:');
  console.log('每个 JSON/Object 字段会被序列化为 JSON 字符串，并标记为 JSON 类型');
  
  // 模拟 RDF 三元组格式
  const subjectUri = 'https://your-pod.solidcommunity.net/users/123';
  const rdfTriples = [
    `<${subjectUri}> rdf:type <${RDF_CLASSES.SCHEMA_PERSON}> .`,
    `<${subjectUri}> <${COMMON_NAMESPACES.schema.uri}name> "Alice Johnson" .`,
    `<${subjectUri}> <${COMMON_NAMESPACES.schema.uri}email> "alice@example.com" .`,
    `<${subjectUri}> <${COMMON_NAMESPACES.schema.uri}preferences> "{\\"theme\\":\\"dark\\",\\"language\\":\\"zh-CN\\",\\"notifications\\":{\\"email\\":true,\\"push\\":false,\\"sms\\":true}}"^^<http://www.w3.org/2001/XMLSchema#json> .`,
    `<${subjectUri}> <${COMMON_NAMESPACES.schema.uri}profile> "{\\"age\\":28,\\"city\\":\\"Beijing\\",\\"occupation\\":\\"Software Engineer\\",\\"skills\\":[\\"TypeScript\\",\\"React\\",\\"Node.js\\"]}"^^<http://www.w3.org/2001/XMLSchema#json> .`
  ];
  
  rdfTriples.forEach(triple => {
    console.log(triple);
  });
  
  console.log('\n3. 存储机制说明:');
  console.log('• JSON 和 Object 数据会被 JSON.stringify() 序列化为字符串');
  console.log('• 使用 XMLSchema#json 数据类型标记，便于查询时识别');
  console.log('• 查询时会自动 JSON.parse() 反序列化回 JavaScript 对象');
  console.log('• 支持嵌套对象、数组等复杂数据结构');
  
  console.log('\n4. 查询时的数据转换:');
  console.log('当从 Solid Pod 查询数据时，JSON 字段会自动转换回 JavaScript 对象:');
  
  const queryResult = {
    id: 123,
    name: 'Alice Johnson',
    email: 'alice@example.com',
    preferences: {
      theme: 'dark',
      language: 'zh-CN',
      notifications: {
        email: true,
        push: false,
        sms: true
      }
    },
    profile: {
      age: 28,
      city: 'Beijing',
      occupation: 'Software Engineer',
      skills: ['TypeScript', 'React', 'Node.js']
    }
  };
  
  console.log(JSON.stringify(queryResult, null, 2));
  
  console.log('\n5. 优势:');
  console.log('• 类型安全：TypeScript 类型推断确保数据结构正确');
  console.log('• 灵活性：可以存储任意复杂的 JSON 结构');
  console.log('• 标准化：使用标准的 RDF 和 JSON 数据类型');
  console.log('• 查询友好：支持 SPARQL 查询和 JSON 操作');
}

// 演示不同数据类型的存储
function demonstrateDataTypes() {
  console.log('\n=== 不同数据类型的存储格式 ===\n');
  
  const examples = [
    {
      type: 'String',
      value: 'Hello World',
      rdf: '"Hello World"'
    },
    {
      type: 'Number',
      value: 42,
      rdf: '42'
    },
    {
      type: 'Boolean',
      value: true,
      rdf: '"true"^^<http://www.w3.org/2001/XMLSchema#boolean>'
    },
    {
      type: 'Date',
      value: new Date('2023-12-01T10:00:00Z'),
      rdf: '"2023-12-01T10:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>'
    },
    {
      type: 'JSON',
      value: { theme: 'dark', language: 'zh-CN' },
      rdf: '"{\\"theme\\":\\"dark\\",\\"language\\":\\"zh-CN\\"}"^^<http://www.w3.org/2001/XMLSchema#json>'
    },
    {
      type: 'Object',
      value: { age: 25, city: 'Beijing' },
      rdf: '"{\\"age\\":25,\\"city\\":\\"Beijing\\"}"^^<http://www.w3.org/2001/XMLSchema#json>'
    }
  ];
  
  examples.forEach(example => {
    console.log(`${example.type}:`);
    console.log(`  JavaScript: ${JSON.stringify(example.value)}`);
    console.log(`  RDF:        ${example.rdf}`);
    console.log('');
  });
}

// 运行演示
if (require.main === module) {
  demonstrateJsonStorage();
  demonstrateDataTypes();
}

export { users };
