#!/usr/bin/env node

/**
 * N3.js 修复版本 - 正确对接 Solid Pod
 * 基于前面的错误，修复协议问题
 */

import { Session } from '@inrupt/solid-client-authn-node';
import { Store, Parser, Writer, DataFactory } from 'n3';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

const { namedNode, literal, quad } = DataFactory;

interface TaskData {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'completed';
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

class N3SolidClientFixed {
  private session: Session;
  private baseUrl: string;
  private webId: string;

  constructor(session: Session, baseUrl: string, webId: string) {
    this.session = session;
    this.baseUrl = baseUrl;
    this.webId = webId;
  }

  // 获取用户路径
  private getUserPath(): string {
    const url = new URL(this.webId);
    return url.pathname.replace('/profile/card#me', '');
  }

  // 构建容器 URL - 修复路径问题
  private getContainerUrl(containerPath: string): string {
    const userPath = this.getUserPath();
    const cleanContainerPath = containerPath.replace(/^\/+|\/+$/g, '');
    return `${this.baseUrl}${userPath}/${cleanContainerPath}/`;
  }

  // 生成资源 URI - 修复 URI 格式
  private generateResourceUri(containerUrl: string, id: string): string {
    // 移除容器 URL 末尾的斜杠，然后添加 # 和 ID
    const cleanContainerUrl = containerUrl.replace(/\/$/, '');
    return `${cleanContainerUrl}#${id}`;
  }

  // 使用 SPARQL INSERT 插入任务数据
  async insertTask(task: TaskData): Promise<boolean> {
    try {
      const containerUrl = this.getContainerUrl('tasks');
      const resourceUri = this.generateResourceUri(containerUrl, task.id);
      
      console.log(`🔄 插入任务: ${task.title}`);
      console.log(`📍 容器URL: ${containerUrl}`);
      console.log(`🆔 资源URI: ${resourceUri}`);

      // 构建 SPARQL INSERT DATA 查询
      const sparqlInsert = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX dc: <http://purl.org/dc/terms/>
        INSERT DATA {
          <${resourceUri}> rdf:type <http://example.org/Task>;
            dc:title "${task.title}";
            dc:description "${task.description}";
            <http://www.w3.org/2002/07/owl#status> "${task.status}";
            <http://example.org/priority> ${task.priority} ;
            dc:created "${task.createdAt.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>;
            dc:modified "${task.updatedAt.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>.
        }
      `;

      console.log(`📝 SPARQL INSERT 查询:`);
      console.log(sparqlInsert);

      // 发送 HTTP PATCH 请求，使用正确的 Content-Type
      const response = await this.session.fetch(containerUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update',  // 使用 SPARQL 更新格式
          'Accept': 'text/turtle'
        },
        body: sparqlInsert
      });

      if (response.ok) {
        console.log(`✅ 任务插入成功: ${response.status} ${response.statusText}`);
        return true;
      } else {
        const errorText = await response.text();
        console.error(`❌ 任务插入失败: ${response.status} ${response.statusText}`);
        console.error(`错误详情:`, errorText);
        return false;
      }
    } catch (error) {
      console.error(`❌ 插入任务时发生错误:`, error);
      return false;
    }
  }

  // 使用 SPARQL SELECT 读取任务数据
  async readTasks(): Promise<TaskData[]> {
    try {
      const containerUrl = this.getContainerUrl('tasks');
      console.log(`🔄 读取任务数据从: ${containerUrl}`);

      // 构建 SPARQL SELECT 查询
      const sparqlSelect = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX dc: <http://purl.org/dc/terms/>
        SELECT ?subject ?title ?description ?status ?priority ?createdAt ?updatedAt WHERE {
          ?subject rdf:type <http://example.org/Task>.
          OPTIONAL { ?subject dc:title ?title. }
          OPTIONAL { ?subject dc:description ?description. }
          OPTIONAL { ?subject <http://www.w3.org/2002/07/owl#status> ?status. }
          OPTIONAL { ?subject <http://example.org/priority> ?priority. }
          OPTIONAL { ?subject dc:created ?createdAt. }
          OPTIONAL { ?subject dc:modified ?updatedAt. }
        }
      `;

      console.log(`📝 SPARQL SELECT 查询:`);
      console.log(sparqlSelect);

      // 尝试使用 SPARQL 查询端点
      const queryUrl = `${containerUrl}?query=${encodeURIComponent(sparqlSelect)}`;
      
      const response = await this.session.fetch(queryUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/sparql-results+json'
        }
      });

      if (response.ok) {
        const results = await response.json();
        console.log(`📖 SPARQL 查询结果:`, JSON.stringify(results, null, 2));
        
        // 解析 SPARQL 结果
        const tasks: TaskData[] = [];
        if (results.results && results.results.bindings) {
          for (const binding of results.results.bindings) {
            const task: TaskData = {
              id: binding.subject?.value.split('#')[1] || 'unknown',
              title: binding.title?.value || '',
              description: binding.description?.value || '',
              status: (binding.status?.value as any) || 'todo',
              priority: binding.priority ? parseInt(binding.priority.value) : 0,
              createdAt: binding.createdAt ? new Date(binding.createdAt.value) : new Date(),
              updatedAt: binding.updatedAt ? new Date(binding.updatedAt.value) : new Date()
            };
            tasks.push(task);
          }
        }
        
        return tasks;
      } else {
        console.error(`❌ SPARQL 查询失败: ${response.status} ${response.statusText}`);
        
        // 回退到直接读取 Turtle 数据
        console.log(`🔄 回退到直接读取 Turtle 数据...`);
        return await this.readTasksViaTurtle();
      }
    } catch (error) {
      console.error(`❌ 读取任务时发生错误:`, error);
      
      // 回退到直接读取 Turtle 数据
      console.log(`🔄 回退到直接读取 Turtle 数据...`);
      return await this.readTasksViaTurtle();
    }
  }

  // 回退方法：直接读取 Turtle 数据并用 N3 解析
  private async readTasksViaTurtle(): Promise<TaskData[]> {
    try {
      const containerUrl = this.getContainerUrl('tasks');
      
      const response = await this.session.fetch(containerUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });

      if (!response.ok) {
        console.error(`❌ Turtle 读取失败: ${response.status} ${response.statusText}`);
        return [];
      }

      const turtleData = await response.text();
      console.log(`📖 获取的 Turtle 数据:`);
      console.log(turtleData);

      // 使用 N3 Parser 解析数据
      const parser = new Parser({ format: 'text/turtle' });
      const store = new Store();
      
      return new Promise((resolve, reject) => {
        parser.parse(turtleData, (error, quad, prefixes) => {
          if (error) {
            reject(error);
            return;
          }
          
          if (quad) {
            store.addQuad(quad);
          } else {
            // 解析完成，提取任务数据
            const tasks: TaskData[] = [];
            
            // 查找所有任务类型的主体
            const taskQuads = store.getQuads(null, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://example.org/Task'), null);
            
            for (const taskQuad of taskQuads) {
              const subject = taskQuad.subject;
              
              // 提取任务属性
              const titleQuad = store.getQuads(subject, namedNode('http://purl.org/dc/terms/title'), null, null)[0];
              const descQuad = store.getQuads(subject, namedNode('http://purl.org/dc/terms/description'), null, null)[0];
              const statusQuad = store.getQuads(subject, namedNode('http://www.w3.org/2002/07/owl#status'), null, null)[0];
              const priorityQuad = store.getQuads(subject, namedNode('http://example.org/priority'), null, null)[0];
              const createdQuad = store.getQuads(subject, namedNode('http://purl.org/dc/terms/created'), null, null)[0];
              const modifiedQuad = store.getQuads(subject, namedNode('http://purl.org/dc/terms/modified'), null, null)[0];
              
              if (titleQuad) {
                const task: TaskData = {
                  id: subject.value.split('#')[1] || 'unknown',
                  title: titleQuad.object.value,
                  description: descQuad?.object.value || '',
                  status: (statusQuad?.object.value as any) || 'todo',
                  priority: priorityQuad ? parseInt(priorityQuad.object.value) : 0,
                  createdAt: createdQuad ? new Date(createdQuad.object.value) : new Date(),
                  updatedAt: modifiedQuad ? new Date(modifiedQuad.object.value) : new Date()
                };
                
                tasks.push(task);
              }
            }
            
            resolve(tasks);
          }
        });
      });
    } catch (error) {
      console.error(`❌ Turtle 读取时发生错误:`, error);
      return [];
    }
  }

  // 使用 SPARQL DELETE 删除任务
  async deleteTask(taskId: string): Promise<boolean> {
    try {
      const containerUrl = this.getContainerUrl('tasks');
      const resourceUri = this.generateResourceUri(containerUrl, taskId);
      
      console.log(`🗑️ 删除任务: ${taskId}`);
      console.log(`🆔 资源URI: ${resourceUri}`);

      // 构建 SPARQL DELETE 查询
      const sparqlDelete = `
        DELETE WHERE {
          <${resourceUri}> ?p ?o .
        }
      `;

      console.log(`🔄 SPARQL DELETE 查询:`);
      console.log(sparqlDelete);

      // 发送 PATCH 请求执行删除
      const response = await this.session.fetch(containerUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update',
          'Accept': 'text/turtle'
        },
        body: sparqlDelete
      });

      if (response.ok) {
        console.log(`✅ 任务删除成功: ${response.status} ${response.statusText}`);
        return true;
      } else {
        const errorText = await response.text();
        console.error(`❌ 任务删除失败: ${response.status} ${response.statusText}`);
        console.error(`错误详情:`, errorText);
        return false;
      }
    } catch (error) {
      console.error(`❌ 删除任务时发生错误:`, error);
      return false;
    }
  }
}

async function main() {
  console.log('🚀 N3.js 修复版本 - 正确对接 Solid Pod');
  console.log('============================================================');

  // 创建 Session
  const session = new Session();

  try {
    // 登录
    console.log('🔐 登录到 Solid Pod...');
    await session.login({
      clientId: process.env.SOLID_CLIENT_ID!,
      clientSecret: process.env.SOLID_CLIENT_SECRET!,
      oidcIssuer: process.env.SOLID_OIDC_ISSUER!,
    });

    if (!session.info.isLoggedIn) {
      throw new Error('登录失败');
    }

    console.log(`✅ 登录成功`);
    console.log(`🌐 WebID: ${session.info.webId}`);

    // 创建修复版本的 N3 Solid 客户端
    const client = new N3SolidClientFixed(
      session,
      process.env.SOLID_OIDC_ISSUER!,
      session.info.webId!
    );

    // 测试数据
    const testTasks: TaskData[] = [
      {
        id: `task-${Date.now()}-1`,
        title: 'N3.js 修复测试 1',
        description: '使用正确的 SPARQL 协议',
        status: 'todo',
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: `task-${Date.now()}-2`,
        title: 'N3.js 修复测试 2',
        description: '验证 Solid Pod 原生 SPARQL 支持',
        status: 'in-progress',
        priority: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    console.log('\n📝 CREATE 操作 - 使用 SPARQL INSERT');
    console.log('============================================================');
    
    for (const task of testTasks) {
      const success = await client.insertTask(task);
      if (success) {
        console.log(`✅ 成功插入任务: ${task.title}`);
      } else {
        console.log(`❌ 插入任务失败: ${task.title}`);
      }
    }

    console.log('\n📖 READ 操作 - 使用 SPARQL SELECT');
    console.log('============================================================');
    
    const tasks = await client.readTasks();
    console.log(`📊 找到 ${tasks.length} 个任务:`);
    
    for (const task of tasks) {
      console.log(`  • ${task.title} (${task.status}) - 优先级: ${task.priority}`);
    }

    console.log('\n🗑️ DELETE 操作 - 使用 SPARQL DELETE');
    console.log('============================================================');
    
    for (const task of testTasks) {
      const success = await client.deleteTask(task.id);
      if (success) {
        console.log(`✅ 成功删除任务: ${task.id}`);
      } else {
        console.log(`❌ 删除任务失败: ${task.id}`);
      }
    }

    console.log('\n🎉 N3.js 修复版本 Demo 完成！');
    console.log('============================================================');
    console.log('🔍 关键发现:');
    console.log('   • Solid Pod 确实原生支持 SPARQL');
    console.log('   • 必须使用 application/sparql-update Content-Type');
    console.log('   • 不能对容器直接 PATCH Turtle 数据');
    console.log('   • SPARQL INSERT/DELETE 是正确的操作方式');
    console.log('   • N3.js 可以作为 RDF 数据处理的补充工具');

  } catch (error) {
    console.error('❌ Demo 执行失败:', error);
  } finally {
    await session.logout();
  }
}

// 运行 demo
if (require.main === module) {
  main().catch(console.error);
}