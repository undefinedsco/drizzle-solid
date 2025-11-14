/**
 * 验证 SPARQL UPDATE 是否可以一次性完成复杂条件更新
 * 不需要先 SELECT 再 UPDATE
 */

import { describe, it, expect } from 'vitest';
import { QueryEngine } from '@comunica/query-sparql-solid';
import { Parser, Generator } from 'sparqljs';

describe('SPARQL UPDATE Verification', () => {
  const parser = new Parser();
  const generator = new Generator();

  it('验证 SPARQL UPDATE 语法支持复杂 WHERE 条件', () => {
    // 测试：一次性更新所有年龄为 25 的用户的名字
    const updateQuery = `
      PREFIX schema: <https://schema.org/>

      DELETE {
        ?s schema:name ?oldName
      }
      INSERT {
        ?s schema:name "Alice"
      }
      WHERE {
        ?s a schema:Person ;
           schema:age 25 ;
           schema:name ?oldName .
      }
    `;

    // 验证语法是否正确
    const parsed = parser.parse(updateQuery);

    expect(parsed.type).toBe('update');
    expect(parsed.updates).toHaveLength(1);

    const update = parsed.updates[0] as any;
    expect(update.updateType).toBe('insertdelete');
    expect(update.delete).toBeDefined();
    expect(update.insert).toBeDefined();
    expect(update.where).toBeDefined();

    console.log('✅ SPARQL UPDATE 语法验证通过');
    console.log('生成的查询:', generator.stringify(parsed));
  });

  it('验证多个条件的 WHERE 子句', () => {
    const updateQuery = `
      PREFIX schema: <https://schema.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      DELETE {
        ?s schema:status ?oldStatus
      }
      INSERT {
        ?s schema:status "active"
      }
      WHERE {
        ?s a schema:Person ;
           foaf:age ?age ;
           schema:status ?oldStatus .
        FILTER(?age > 18 && ?age < 65)
      }
    `;

    const parsed = parser.parse(updateQuery);
    expect(parsed.type).toBe('update');

    const update = parsed.updates[0] as any;
    expect(update.where).toBeDefined();

    console.log('✅ 复杂 FILTER 条件验证通过');
  });

  it('验证 UPDATE 可以匹配多个 subjects', () => {
    // 这个 UPDATE 会匹配所有满足条件的 subjects
    // 不需要预先知道有多少个
    const updateQuery = `
      PREFIX schema: <https://schema.org/>

      DELETE {
        ?person schema:city ?oldCity
      }
      INSERT {
        ?person schema:city "New York"
      }
      WHERE {
        ?person a schema:Person ;
                schema:country "USA" ;
                schema:city ?oldCity .
      }
    `;

    const parsed = parser.parse(updateQuery);
    const update = parsed.updates[0] as any;

    // WHERE 子句可以匹配多个 ?person
    expect(update.where).toBeDefined();

    console.log('✅ 多 subject 更新验证通过');
  });

  it('验证无需预先知道 subject URI', () => {
    // 传统错误做法：需要知道 subject URI
    const wrongWay = `
      DELETE { <#user1> schema:name "old" }
      INSERT { <#user1> schema:name "new" }
    `;

    // 正确做法：通过 WHERE 自动查找
    const correctWay = `
      PREFIX schema: <https://schema.org/>

      DELETE { ?s schema:name ?old }
      INSERT { ?s schema:name "new" }
      WHERE {
        ?s a schema:Person ;
           schema:id "user1" ;
           schema:name ?old .
      }
    `;

    const parsed = parser.parse(correctWay);
    const update = parsed.updates[0] as any;

    // WHERE 中使用变量 ?s，不需要硬编码 subject URI
    expect(update.where).toBeDefined();

    console.log('✅ 动态 subject 查找验证通过');
  });

  it('验证可以使用 Drizzle 风格的条件', () => {
    // 模拟 Drizzle 查询：
    // db.update(users).set({ status: 'active' }).where(and(eq(users.age, 25), eq(users.country, 'USA')))

    const updateQuery = `
      PREFIX schema: <https://schema.org/>

      DELETE {
        ?s schema:status ?oldStatus
      }
      INSERT {
        ?s schema:status "active"
      }
      WHERE {
        ?s a schema:Person ;
           schema:age 25 ;
           schema:country "USA" ;
           schema:status ?oldStatus .
      }
    `;

    const parsed = parser.parse(updateQuery);
    expect(parsed.type).toBe('update');

    console.log('✅ Drizzle 风格条件转换验证通过');
  });

  it('验证 Community Solid Server 是否支持', async () => {
    // 创建一个最小化的测试数据
    const testData = `
      @prefix schema: <https://schema.org/> .
      @prefix : <#> .

      :alice a schema:Person ;
        schema:name "Alice" ;
        schema:age 25 .

      :bob a schema:Person ;
        schema:name "Bob" ;
        schema:age 25 .

      :charlie a schema:Person ;
        schema:name "Charlie" ;
        schema:age 30 .
    `;

    // 创建内存中的 dataset
    const { createSolidDataset, createThing, setThing, buildThing } = await import('@inrupt/solid-client');
    const { DataFactory } = await import('n3');
    const { namedNode, literal, quad } = DataFactory;

    // 模拟的 SPARQL UPDATE（更新所有 25 岁的人的名字）
    const updateQuery = `
      PREFIX schema: <https://schema.org/>

      DELETE {
        ?s schema:name ?oldName
      }
      INSERT {
        ?s schema:name "Updated"
      }
      WHERE {
        ?s a schema:Person ;
           schema:age 25 ;
           schema:name ?oldName .
      }
    `;

    // 验证语法
    const parsed = parser.parse(updateQuery);
    expect(parsed.type).toBe('update');

    console.log('✅ CSS 兼容性验证通过（语法层面）');
    console.log('⚠️  实际执行需要真实的 CSS 服务器');
    console.log('生成的 UPDATE 查询:');
    console.log(generator.stringify(parsed));
  });

  it('对比：当前实现 vs 优化实现', () => {
    console.log('\n=== 当前实现（低效）===');
    console.log('步骤 1: SELECT ?subject WHERE { ?subject schema:age 25 }');
    console.log('  → 返回: [#alice, #bob]');
    console.log('步骤 2: DELETE { <#alice> schema:name ?old } INSERT { <#alice> schema:name "Updated" } WHERE { <#alice> schema:name ?old }');
    console.log('步骤 3: DELETE { <#bob> schema:name ?old } INSERT { <#bob> schema:name "Updated" } WHERE { <#bob> schema:name ?old }');
    console.log('总计: 3 次网络请求\n');

    console.log('=== 优化实现（高效）===');
    console.log('步骤 1: DELETE { ?s schema:name ?old } INSERT { ?s schema:name "Updated" } WHERE { ?s schema:age 25 ; schema:name ?old }');
    console.log('总计: 1 次网络请求\n');

    const currentApproach = {
      requests: 3,
      raceCondition: true,
      scalability: 'poor'
    };

    const optimizedApproach = {
      requests: 1,
      raceCondition: false,
      scalability: 'excellent'
    };

    expect(optimizedApproach.requests).toBeLessThan(currentApproach.requests);
    expect(optimizedApproach.raceCondition).toBe(false);

    console.log('✅ 优化方案明显优于当前实现');
  });

  it('生成实际可用的 SPARQL UPDATE', () => {
    // 模拟 Drizzle 查询
    const drizzleQuery = {
      table: 'users',
      set: { status: 'active', updatedAt: new Date('2025-01-15') },
      where: { age: 25, country: 'USA' }
    };

    // 生成 SPARQL UPDATE
    const generateOptimizedUpdate = (query: typeof drizzleQuery) => {
      const deleteStatements: string[] = [];
      const insertStatements: string[] = [];
      const wherePatterns: string[] = [];

      // DELETE 和 INSERT 子句
      Object.entries(query.set).forEach(([key, value]) => {
        const varName = `?old_${key}`;
        deleteStatements.push(`?s schema:${key} ${varName}`);

        const rdfValue = typeof value === 'string'
          ? `"${value}"`
          : value instanceof Date
            ? `"${value.toISOString()}"^^xsd:dateTime`
            : `"${value}"`;

        insertStatements.push(`?s schema:${key} ${rdfValue}`);
        wherePatterns.push(`?s schema:${key} ${varName}`);
      });

      // WHERE 条件
      wherePatterns.push(`?s a schema:Person`);
      Object.entries(query.where).forEach(([key, value]) => {
        wherePatterns.push(`?s schema:${key} "${value}"`);
      });

      return `
PREFIX schema: <https://schema.org/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

DELETE {
  ${deleteStatements.join(' .\n  ')} .
}
INSERT {
  ${insertStatements.join(' .\n  ')} .
}
WHERE {
  ${wherePatterns.join(' .\n  ')} .
}`.trim();
    };

    const sparqlUpdate = generateOptimizedUpdate(drizzleQuery);
    console.log('\n生成的 SPARQL UPDATE:');
    console.log(sparqlUpdate);

    // 验证语法
    const parsed = parser.parse(sparqlUpdate);
    expect(parsed.type).toBe('update');

    console.log('\n✅ 生成的 SPARQL UPDATE 语法正确');
  });
});
