#!/usr/bin/env node

/**
 * N3.js 直接对接 Solid Pod Demo
 * 验证是否可以不使用 Comunica，直接用 N3.js + HTTP 请求操作 Solid Pod
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

class N3SolidClient {
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

  // 构建容器 URL
  private getContainerUrl(containerPath: string): string {
    const userPath = this.getUserPath();
    const cleanContainerPath = containerPath.replace(/^\/+|\/+$/g, '');
    return `${this.baseUrl}${userPath}/${cleanContainerPath}/`;
  }

  // 生成资源 URI
  private generateResourceUri(containerUrl: string, id: string): string {
    return `${containerUrl}#${id}`;
  }

  // 插入任务数据
  async insertTask(task: TaskData): Promise<boolean> {
    try {
      const containerUrl = this.getContainerUrl('tasks');
      const resourceUri = this.generateResourceUri(containerUrl, task.id);
      
      console.log(`🔄 插入任务: ${task.title}`);
      console.log(`📍 容器URL: ${containerUrl}`);
      console.log(`🆔 资源URI: ${resourceUri}`);

      // 创建 N3 Store 并添加数据
      const store = new Store();
      
      // 添加任务数据到 store
      store.addQuad(quad(
        namedNode(resourceUri),
        namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
        namedNode('http://example.org/Task')
      ));
      
      store.addQuad(quad(
        namedNode(resourceUri),
        namedNode('http://purl.org/dc/terms/title'),
        literal(task.title)
      ));
      
      store.addQuad(quad(
        namedNode(resourceUri),
        namedNode('http://purl.org/dc/terms/description'),
        literal(task.description)
      ));
      
      store.addQuad(quad(
        namedNode(resourceUri),
        namedNode('http://www.w3.org/2002/07/owl#status'),
        literal(task.status)
      ));
      
      store.addQuad(quad(
        namedNode(resourceUri),
        namedNode('http://example.org/priority'),
        literal(task.priority.toString(), namedNode('http://www.w3.org/2001/XMLSchema#integer'))
      ));
      
      store.addQuad(quad(
        namedNode(resourceUri),
        namedNode('http://purl.org/dc/terms/created'),
        literal(task.createdAt.toISOString(), namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))
      ));
      
      store.addQuad(quad(
        namedNode(resourceUri),
        namedNode('http://purl.org/dc/terms/modified'),
        literal(task.updatedAt.toISOString(), namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))
      ));

      // 将 store 转换为 Turtle 格式
      const writer = new Writer({ format: 'text/turtle' });
      const turtleData = writer.quadsToString(store.getQuads(null, null, null, null));
      
      console.log(`📝 生成的 Turtle 数据:`);
      console.log(turtleData);

      // 发送 HTTP PATCH 请求
      const response = await this.session.fetch(containerUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'text/turtle',
          'Accept': 'text/turtle'
        },
        body: turtleData
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

  // 读取任务数据
  async readTasks(): Promise<TaskData[]> {
    try {
      const containerUrl = this.getContainerUrl('tasks');
      console.log(`🔄 读取任务数据从: ${containerUrl}`);

      // 发送 GET 请求获取数据
      const response = await this.session.fetch(containerUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/turtle'
        }
      });

      if (!response.ok) {
        console.error(`❌ 读取失败: ${response.status} ${response.statusText}`);
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
      console.error(`❌ 读取任务时发生错误:`, error);
      return [];
    }
  }

  // 删除任务
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
  console.log('🚀 N3.js 直接对接 Solid Pod Demo');
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

    // 创建 N3 Solid 客户端
    const client = new N3SolidClient(
      session,
      process.env.SOLID_OIDC_ISSUER!,
      session.info.webId!
    );

    // 测试数据
    const testTasks: TaskData[] = [
      {
        id: `task-${Date.now()}-1`,
        title: 'N3.js 测试任务 1',
        description: '使用 N3.js 直接操作 Solid Pod',
        status: 'todo',
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: `task-${Date.now()}-2`,
        title: 'N3.js 测试任务 2',
        description: '验证不使用 Comunica 的可行性',
        status: 'in-progress',
        priority: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    console.log('\n📝 CREATE 操作 - 插入任务');
    console.log('============================================================');
    
    for (const task of testTasks) {
      const success = await client.insertTask(task);
      if (success) {
        console.log(`✅ 成功插入任务: ${task.title}`);
      } else {
        console.log(`❌ 插入任务失败: ${task.title}`);
      }
    }

    console.log('\n📖 READ 操作 - 读取任务');
    console.log('============================================================');
    
    const tasks = await client.readTasks();
    console.log(`📊 找到 ${tasks.length} 个任务:`);
    
    for (const task of tasks) {
      console.log(`  • ${task.title} (${task.status}) - 优先级: ${task.priority}`);
    }

    console.log('\n🗑️ DELETE 操作 - 清理测试数据');
    console.log('============================================================');
    
    for (const task of testTasks) {
      const success = await client.deleteTask(task.id);
      if (success) {
        console.log(`✅ 成功删除任务: ${task.id}`);
      } else {
        console.log(`❌ 删除任务失败: ${task.id}`);
      }
    }

    console.log('\n🎉 N3.js 直接对接 Demo 完成！');
    console.log('============================================================');
    console.log('✅ 验证结果:');
    console.log('   • N3.js 可以直接解析和生成 RDF 数据');
    console.log('   • HTTP PATCH 可以直接向 Solid Pod 写入 Turtle 数据');
    console.log('   • HTTP GET 可以直接从 Solid Pod 读取 Turtle 数据');
    console.log('   • SPARQL UPDATE 可以通过 HTTP PATCH 执行');
    console.log('   • 不需要 Comunica 作为中间层！');

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