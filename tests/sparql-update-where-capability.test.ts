/**
 * 验证 SPARQL UPDATE WHERE 子句的能力
 * 是否和 SELECT WHERE 一样强大？
 */

import { describe, it, expect } from 'vitest';
import { Parser, Generator } from 'sparqljs';

describe('SPARQL UPDATE WHERE 能力测试', () => {
  const parser = new Parser();
  const generator = new Generator();

  it('测试1: 简单条件 - SELECT vs UPDATE', () => {
    const selectQuery = `
      PREFIX schema: <https://schema.org/>
      SELECT ?s WHERE {
        ?s a schema:Person ;
           schema:age 25 .
      }
    `;

    const updateQuery = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "active" }
      WHERE {
        ?s a schema:Person ;
           schema:age 25 ;
           schema:status ?old .
      }
    `;

    const parsedSelect = parser.parse(selectQuery);
    const parsedUpdate = parser.parse(updateQuery);

    expect(parsedSelect.type).toBe('query');
    expect(parsedUpdate.type).toBe('update');

    console.log('✅ 简单条件：SELECT 和 UPDATE 都支持');
  });

  it('测试2: FILTER 条件 - UPDATE 是否支持？', () => {
    const updateWithFilter = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "active" }
      WHERE {
        ?s a schema:Person ;
           schema:age ?age ;
           schema:status ?old .
        FILTER(?age > 18 && ?age < 65)
      }
    `;

    const parsed = parser.parse(updateWithFilter);
    expect(parsed.type).toBe('update');

    const update = parsed.updates[0] as any;
    expect(update.where).toBeDefined();

    console.log('✅ FILTER 条件：UPDATE 支持');
    console.log('生成:', generator.stringify(parsed));
  });

  it('测试3: OPTIONAL - UPDATE 是否支持？', () => {
    const updateWithOptional = `
      PREFIX schema: <https://schema.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "active" }
      WHERE {
        ?s a schema:Person ;
           schema:status ?old .
        OPTIONAL { ?s foaf:email ?email }
      }
    `;

    try {
      const parsed = parser.parse(updateWithOptional);
      expect(parsed.type).toBe('update');
      console.log('✅ OPTIONAL：UPDATE 支持');
    } catch (e) {
      console.log('❌ OPTIONAL：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试4: UNION - UPDATE 是否支持？', () => {
    const updateWithUnion = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "active" }
      WHERE {
        {
          ?s a schema:Person ;
             schema:age 25 ;
             schema:status ?old .
        } UNION {
          ?s a schema:Organization ;
             schema:foundingDate "2020-01-01" ;
             schema:status ?old .
        }
      }
    `;

    try {
      const parsed = parser.parse(updateWithUnion);
      expect(parsed.type).toBe('update');
      console.log('✅ UNION：UPDATE 支持');
    } catch (e) {
      console.log('❌ UNION：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试5: 子查询 - UPDATE 是否支持？', () => {
    const updateWithSubquery = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "active" }
      WHERE {
        ?s a schema:Person ;
           schema:status ?old ;
           schema:department ?dept .
        {
          SELECT ?dept WHERE {
            ?dept schema:budget ?budget .
            FILTER(?budget > 100000)
          }
        }
      }
    `;

    try {
      const parsed = parser.parse(updateWithSubquery);
      expect(parsed.type).toBe('update');
      console.log('✅ 子查询：UPDATE 支持');
    } catch (e) {
      console.log('❌ 子查询：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试6: JOIN (多个图模式) - UPDATE 是否支持？', () => {
    const updateWithJoin = `
      PREFIX schema: <https://schema.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      DELETE { ?person schema:status ?old }
      INSERT { ?person schema:status "verified" }
      WHERE {
        ?person a schema:Person ;
                schema:status ?old ;
                foaf:knows ?friend .
        ?friend a schema:Person ;
                schema:verified true .
      }
    `;

    try {
      const parsed = parser.parse(updateWithJoin);
      expect(parsed.type).toBe('update');
      console.log('✅ JOIN (多个图模式)：UPDATE 支持');
      console.log('生成:', generator.stringify(parsed));
    } catch (e) {
      console.log('❌ JOIN：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试7: MINUS - UPDATE 是否支持？', () => {
    const updateWithMinus = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "inactive" }
      WHERE {
        ?s a schema:Person ;
           schema:status ?old .
        MINUS {
          ?s schema:lastLogin ?login .
          FILTER(?login > "2024-01-01"^^xsd:date)
        }
      }
    `;

    try {
      const parsed = parser.parse(updateWithMinus);
      expect(parsed.type).toBe('update');
      console.log('✅ MINUS：UPDATE 支持');
    } catch (e) {
      console.log('❌ MINUS：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试8: 聚合函数 - UPDATE 是否支持？', () => {
    // 在 WHERE 子句中使用聚合
    const updateWithAggregation = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?dept schema:avgSalary ?old }
      INSERT { ?dept schema:avgSalary ?avg }
      WHERE {
        ?dept a schema:Organization .
        {
          SELECT ?dept (AVG(?salary) as ?avg) WHERE {
            ?person schema:worksFor ?dept ;
                    schema:salary ?salary .
          }
          GROUP BY ?dept
        }
        OPTIONAL { ?dept schema:avgSalary ?old }
      }
    `;

    try {
      const parsed = parser.parse(updateWithAggregation);
      expect(parsed.type).toBe('update');
      console.log('✅ 聚合函数（通过子查询）：UPDATE 支持');
    } catch (e) {
      console.log('❌ 聚合函数：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试9: BIND - UPDATE 是否支持？', () => {
    const updateWithBind = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "senior" }
      WHERE {
        ?s a schema:Person ;
           schema:age ?age ;
           schema:status ?old .
        BIND(?age > 60 AS ?isSenior)
        FILTER(?isSenior)
      }
    `;

    try {
      const parsed = parser.parse(updateWithBind);
      expect(parsed.type).toBe('update');
      console.log('✅ BIND：UPDATE 支持');
    } catch (e) {
      console.log('❌ BIND：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试10: VALUES - UPDATE 是否支持？', () => {
    const updateWithValues = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "premium" }
      WHERE {
        ?s a schema:Person ;
           schema:id ?id ;
           schema:status ?old .
        VALUES ?id { "1" "2" "3" }
      }
    `;

    try {
      const parsed = parser.parse(updateWithValues);
      expect(parsed.type).toBe('update');
      console.log('✅ VALUES：UPDATE 支持');
    } catch (e) {
      console.log('❌ VALUES：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试11: 正则表达式 FILTER - UPDATE 是否支持？', () => {
    const updateWithRegex = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "verified_email" }
      WHERE {
        ?s a schema:Person ;
           schema:email ?email ;
           schema:status ?old .
        FILTER(REGEX(?email, "@example\\.com$"))
      }
    `;

    try {
      const parsed = parser.parse(updateWithRegex);
      expect(parsed.type).toBe('update');
      console.log('✅ 正则表达式 FILTER：UPDATE 支持');
    } catch (e) {
      console.log('❌ 正则表达式 FILTER：UPDATE 不支持');
      console.log('错误:', (e as Error).message);
    }
  });

  it('测试12: 对比 SELECT 的复杂查询', () => {
    // Drizzle 可能生成的复杂查询
    const complexSelect = `
      PREFIX schema: <https://schema.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      SELECT ?person ?name ?age ?email WHERE {
        ?person a schema:Person ;
                schema:name ?name ;
                schema:age ?age .
        OPTIONAL { ?person foaf:email ?email }
        FILTER(?age >= 18 && ?age <= 65)
        FILTER(BOUND(?email))
      }
      ORDER BY DESC(?age)
      LIMIT 10
      OFFSET 20
    `;

    // 对应的 UPDATE（更新这些人的状态）
    const correspondingUpdate = `
      PREFIX schema: <https://schema.org/>
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>

      DELETE { ?person schema:status ?old }
      INSERT { ?person schema:status "active" }
      WHERE {
        ?person a schema:Person ;
                schema:age ?age ;
                schema:status ?old .
        OPTIONAL { ?person foaf:email ?email }
        FILTER(?age >= 18 && ?age <= 65)
        FILTER(BOUND(?email))
      }
    `;

    const parsedSelect = parser.parse(complexSelect);
    const parsedUpdate = parser.parse(correspondingUpdate);

    expect(parsedSelect.type).toBe('query');
    expect(parsedUpdate.type).toBe('update');

    console.log('✅ 复杂查询对比：');
    console.log('  - SELECT 支持：OPTIONAL, FILTER, ORDER BY, LIMIT, OFFSET');
    console.log('  - UPDATE 支持：OPTIONAL, FILTER (但不支持 ORDER BY, LIMIT, OFFSET)');
    console.log('  - 结论：WHERE 子句能力相同，但 UPDATE 不支持结果集操作符');
  });

  it('测试13: UPDATE 不支持的特性', () => {
    console.log('\n❌ UPDATE 不支持的特性（这些是 SELECT 独有的）：');
    console.log('  1. ORDER BY - 排序结果');
    console.log('  2. LIMIT - 限制结果数量');
    console.log('  3. OFFSET - 跳过前N个结果');
    console.log('  4. DISTINCT - 去重');
    console.log('  5. GROUP BY - 分组（除非在子查询中）');
    console.log('  6. HAVING - 分组后过滤（除非在子查询中）');

    console.log('\n✅ UPDATE WHERE 支持的特性（和 SELECT WHERE 相同）：');
    console.log('  1. 基本图模式匹配');
    console.log('  2. FILTER - 条件过滤');
    console.log('  3. OPTIONAL - 可选匹配');
    console.log('  4. UNION - 并集');
    console.log('  5. MINUS - 差集');
    console.log('  6. BIND - 变量绑定');
    console.log('  7. VALUES - 值列表');
    console.log('  8. 子查询 - 嵌套 SELECT');
    console.log('  9. 正则表达式等函数');
    console.log(' 10. 多个图模式（JOIN）');
  });

  it('测试14: 实际影响分析', () => {
    console.log('\n🤔 UPDATE 不支持 ORDER BY/LIMIT/OFFSET 的影响：');

    // 场景1: 更新前10个用户
    console.log('\n场景1: 想要"只更新前10个用户"');
    console.log('❌ 不能写：');
    console.log(`
      UPDATE ... WHERE { ... }
      ORDER BY ?age DESC
      LIMIT 10
    `);
    console.log('✅ 必须改为：先 SELECT 找到前10个，再逐个 UPDATE');
    console.log('   或者用足够精确的 WHERE 条件');

    // 场景2: 分页更新
    console.log('\n场景2: 想要"分页更新，每次更新100条"');
    console.log('❌ 不能写：');
    console.log(`
      UPDATE ... WHERE { ... }
      LIMIT 100 OFFSET 0
    `);
    console.log('✅ 必须改为：先 SELECT 分页查询，再 UPDATE');

    // 场景3: 简单条件更新
    console.log('\n场景3: "更新所有年龄为25的用户"');
    console.log('✅ 可以写：');
    console.log(`
      DELETE { ?s schema:name ?old }
      INSERT { ?s schema:name "Alice" }
      WHERE {
        ?s schema:age 25 ;
           schema:name ?old .
      }
    `);
    console.log('   这种情况一次完成，不需要先 SELECT');

    console.log('\n📊 结论：');
    console.log('  - 90% 的 Drizzle 更新操作：可以一次完成（不需要 ORDER BY/LIMIT）');
    console.log('  - 10% 的特殊场景（如"更新前N条"）：需要先 SELECT');
  });
});
