import { drizzle, solid, podTable, string, int, bool, date, json, object, getTableSchema } from '../src/index';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

// 定义表结构
const users = podTable('users', {
  id: int('id').primaryKey(),
  name: string('name').notNull(),
  email: string('email').notNull(),
  age: int('age'),
  isActive: bool('isActive').default(true),
  createdAt: date('createdAt'),
  profile: json('profile'),
  metadata: object('metadata')
}, {
  containerPath: '/users/',
  rdfClass: 'https://schema.org/Person',
  namespace: { prefix: 'schema', uri: 'https://schema.org/' }
});

// 创建数据库连接
const db = drizzle(solid({
  webId: 'https://your-pod.solidcommunity.net/profile/card#me'
}));

// 创建 Zod 模式
const userSchema = getTableSchema(users);

async function demonstrateZodIntegration() {
  console.log('=== Drizzle-Zod 集成示例 ===\n');

  // 1. 基本验证
  console.log('1. 基本数据验证:');
  
  const validUserData = {
    id: 1,
    name: 'Alice Johnson',
    email: 'alice@example.com',
    age: 30,
    isActive: true,
    createdAt: new Date(),
    profile: { theme: 'dark', language: 'en' },
    metadata: { source: 'web', version: '1.0' }
  };

  try {
    const validatedUser = userSchema.validate(validUserData);
    console.log('✅ 验证通过:', validatedUser);
  } catch (error) {
    console.log('❌ 验证失败:', error);
  }

  // 2. 插入数据验证
  console.log('\n2. 插入数据验证:');
  
  const insertData = {
    name: 'Bob Smith',
    email: 'bob@example.com',
    age: 25,
    profile: { theme: 'light' }
    // 注意：id 是主键，可选；isActive 有默认值，可选
  };

  try {
    const validatedInsert = userSchema.validateInsert(insertData);
    console.log('✅ 插入数据验证通过:', validatedInsert);
  } catch (error) {
    console.log('❌ 插入数据验证失败:', error);
  }

  // 3. 更新数据验证
  console.log('\n3. 更新数据验证:');
  
  const updateData = {
    age: 26,
    isActive: false
    // 更新时所有字段都是可选的
  };

  try {
    const validatedUpdate = userSchema.validateUpdate(updateData);
    console.log('✅ 更新数据验证通过:', validatedUpdate);
  } catch (error) {
    console.log('❌ 更新数据验证失败:', error);
  }

  // 4. 安全验证（不抛出异常）
  console.log('\n4. 安全验证:');
  
  const invalidData = {
    id: 'not-a-number', // 应该是数字
    name: 123, // 应该是字符串
    email: 'invalid-email' // 格式可能有问题
  };

  const safeResult = userSchema.safeValidate(invalidData);
  if (safeResult.success) {
    console.log('✅ 安全验证通过:', safeResult.data);
  } else {
    console.log('❌ 安全验证失败:', safeResult.error.issues);
  }

  // 5. 自定义验证规则
  console.log('\n5. 自定义验证规则:');
  
  // 创建带有自定义验证的模式
  const customUserSchema = userSchema.schema.extend({
    email: z.string().email('必须是有效的邮箱地址'),
    age: z.number().int().min(0, '年龄不能为负数').max(150, '年龄不能超过150'),
    name: z.string().min(2, '姓名至少2个字符').max(50, '姓名不能超过50个字符')
  });

  const customData = {
    id: 1,
    name: 'A', // 太短
    email: 'invalid-email', // 无效邮箱
    age: -5, // 负数
    isActive: true,
    createdAt: new Date(),
    profile: { theme: 'dark' },
    metadata: { source: 'web' }
  };

  const customResult = customUserSchema.safeParse(customData);
  if (customResult.success) {
    console.log('✅ 自定义验证通过:', customResult.data);
  } else {
    console.log('❌ 自定义验证失败:');
    customResult.error.issues.forEach(issue => {
      console.log(`  - ${issue.path.join('.')}: ${issue.message}`);
    });
  }

  // 6. 与数据库操作集成
  console.log('\n6. 与数据库操作集成:');
  
  try {
    // 验证插入数据
    const insertDataValidated = userSchema.validateInsert({
      name: 'Charlie Brown',
      email: 'charlie@example.com',
      age: 35
    });

    // 执行插入操作
    const insertResult = await db.insert(users).values(insertDataValidated);
    console.log('✅ 插入操作成功:', insertResult);

    // 验证更新数据
    const updateDataValidated = userSchema.validateUpdate({
      age: 36,
      isActive: false
    });

    // 执行更新操作
    const updateResult = await db.update(users)
      .set(updateDataValidated)
      .where({ id: 1 });
    console.log('✅ 更新操作成功:', updateResult);

  } catch (error) {
    console.log('❌ 数据库操作失败:', error);
  }

  // 7. 批量验证
  console.log('\n7. 批量验证:');
  
  const batchData = [
    { name: 'User 1', email: 'user1@example.com', age: 20 },
    { name: 'User 2', email: 'user2@example.com', age: 25 },
    { name: 'User 3', email: 'user3@example.com', age: 30 }
  ];

  const batchResults = batchData.map((data, index) => {
    const result = userSchema.safeValidateInsert(data);
    return {
      index,
      success: result.success,
      data: result.success ? result.data : null,
      errors: result.success ? null : result.error.issues
    };
  });

  batchResults.forEach(result => {
    if (result.success) {
      console.log(`✅ 用户 ${result.index + 1} 验证通过`);
    } else {
      console.log(`❌ 用户 ${result.index + 1} 验证失败:`, result.errors);
    }
  });
}

// 运行示例
demonstrateZodIntegration().catch(console.error);
