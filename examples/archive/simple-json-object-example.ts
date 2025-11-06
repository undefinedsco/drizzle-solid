import { podTable, string, int, json, object, date, COMMON_NAMESPACES, RDF_CLASSES } from '../src/index';

// 用户表 - 包含 JSON 和 Object 字段
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

// 演示 JSON 和 Object 字段的使用
function demonstrateJsonObjectTypes() {
  console.log('=== JSON 和 Object 类型演示 ===');
  
  // 显示表结构
  console.log('用户表字段:');
  Object.entries(users.columns).forEach(([name, column]) => {
    console.log(`  ${name}: ${column.dataType} (required: ${column.options.required})`);
  });
  
  // 演示 JSON 字段
  console.log('\nJSON 字段示例:');
  const jsonData = {
    theme: 'dark',
    language: 'zh-CN',
    notifications: {
      email: true,
      push: false,
      sms: true
    }
  };
  console.log('用户偏好设置:', jsonData);
  
  // 演示 Object 字段
  console.log('\nObject 字段示例:');
  const objectData = {
    age: 28,
    city: 'Beijing',
    occupation: 'Software Engineer',
    skills: ['TypeScript', 'React', 'Node.js']
  };
  console.log('用户档案:', objectData);
  
  // 演示链式方法
  console.log('\n链式方法演示:');
  const jsonColumn = json('settings').notNull();
  const objectColumn = object('metadata').notNull();
  
  console.log('JSON 列配置:', {
    name: jsonColumn.name,
    dataType: jsonColumn.dataType,
    required: jsonColumn.options.required
  });
  
  console.log('Object 列配置:', {
    name: objectColumn.name,
    dataType: objectColumn.dataType,
    required: objectColumn.options.required
  });
}

// 运行演示
if (require.main === module) {
  demonstrateJsonObjectTypes();
}

export { users };
