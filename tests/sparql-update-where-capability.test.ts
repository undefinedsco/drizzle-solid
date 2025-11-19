/**
 * 验证 SPARQL UPDATE WHERE 子句的能力
 * 是否和 SELECT WHERE 一样强大？
 */

import { describe, it, expect } from 'vitest';
import { Parser, Generator } from 'sparqljs';

describe('SPARQL UPDATE WHERE 能力测试', () => {
  const parser = new Parser();
  const generator = new Generator();

  const expectSelectParses = (query: string) => {
    const parsed = parser.parse(query);
    expect(parsed.type).toBe('query');
    return parsed;
  };

  const expectUpdateParses = (query: string) => {
    const parsed = parser.parse(query);
    expect(parsed.type).toBe('update');
    return parsed;
  };

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

    expectSelectParses(selectQuery);
    expectUpdateParses(updateQuery);
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

    const parsed = expectUpdateParses(updateWithFilter);
    const update = parsed.updates[0] as any;
    expect(update.where).toBeDefined();
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

    expect(() => expectUpdateParses(updateWithOptional)).not.toThrow();
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

    expect(() => expectUpdateParses(updateWithUnion)).not.toThrow();
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

    expect(() => expectUpdateParses(updateWithSubquery)).not.toThrow();
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

    const parsed = expectUpdateParses(updateWithJoin);
    expect(generator.stringify(parsed)).toBeDefined();
  });

  it('测试7: MINUS - UPDATE 是否支持？', () => {
    const updateWithMinus = `
      PREFIX schema: <https://schema.org/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
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

    expect(() => expectUpdateParses(updateWithMinus)).not.toThrow();
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

    expect(() => expectUpdateParses(updateWithAggregation)).not.toThrow();
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

    expect(() => expectUpdateParses(updateWithBind)).not.toThrow();
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

    expect(() => expectUpdateParses(updateWithValues)).not.toThrow();
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
        FILTER(REGEX(?email, "@example\\\\.com$"))
      }
    `;

    expect(() => expectUpdateParses(updateWithRegex)).not.toThrow();
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

    const parsedSelect = expectSelectParses(complexSelect);
    const parsedUpdate = expectUpdateParses(correspondingUpdate);
    expect(parsedSelect).toBeDefined();
    expect(parsedUpdate).toBeDefined();
  });

  it('测试13: UPDATE 不支持 ORDER BY/LIMIT/OFFSET', () => {
    const updateWithOrderBy = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "active" }
      WHERE {
        ?s a schema:Person ;
           schema:status ?old ;
           schema:age ?age .
      }
      ORDER BY ?age
      LIMIT 10
      OFFSET 5
    `;

    expect(() => parser.parse(updateWithOrderBy)).toThrow();
  });

  it('测试14: 需要两步执行的场景', () => {
    const requiresTwoPhase = `
      PREFIX schema: <https://schema.org/>
      DELETE { ?s schema:status ?old }
      INSERT { ?s schema:status "active" }
      WHERE {
        ?s a schema:Person ;
           schema:status ?old ;
           schema:age ?age .
      }
      ORDER BY ?age DESC
      LIMIT 10
    `;

    expect(() => parser.parse(requiresTwoPhase)).toThrow();
  });
});
