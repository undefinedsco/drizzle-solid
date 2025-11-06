#!/usr/bin/env node

/**
 * Solid 协议正确实现 Demo
 * 基于 Solid 规范的正确做法：对资源文件而不是容器执行操作
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

class SolidProtocolClient {
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

  // 构建资源文件 URL（不是容器）
  private getResourceUrl(containerPath: string, resourceName: string): string {
    const userPath = this.getUserPath();
    const cleanContainerPath = containerPath.replace(/^\/+|\/+$/g, '');
    return `${this.baseUrl}${userPath}/${cleanContainerPath}/${resourceName}`;
  }

  // 生成资源 URI（用于 RDF 中的主体）
  private generateResourceUri(resourceUrl: string, id: string): string {
    return `${resourceUrl}#${id}`;
  }

  // 确保容器存在
  private async ensureContainer(containerPath: string): Promise<boolean> {
    try {
      const containerUrl = this.getContainerUrl(containerPath);
      
      const response = await this.session.fetch(containerUrl, {
        method: 'HEAD'
      });
      
      if (response.ok) {
        console.log(`✅ 容器已存在: ${containerUrl}`);
        return true;
      } else if (response.status === 404) {
        console.log(`🔄 创建容器: ${containerUrl}`);
        
        // 创建容器
        const createResponse = await this.session.fetch(containerUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/turtle',
            'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
          },
          body: ''
        });
        
        if (createResponse.ok) {
          console.log(`✅ 容器创建成功: ${containerUrl}`);
          return true;
        } else {
          console.error(`❌ 容器创建失败: ${createResponse.status} ${createResponse.statusText}`);
          return false;
        }
      } else {
        console.error(`❌ 检查容器失败: ${response.status} ${response.statusText}`);
        return false;
      }
    } catch (error) {
      console.error(`❌ 确保容器存在时发生错误:`, error);
      return false;
    }
  }

  // 插入任务数据到具体的资源文件
  async insertTask(task: TaskData): Promise<boolean> {
    try {
      // 确保容器存在
      const containerExists = await this.ensureContainer('tasks');
      if (!containerExists) {
        console.error('❌ 无法创建或访问容器');
        return false;
      }

      const resourceUrl = this.getResourceUrl('tasks', 'data.ttl');
      const resourceUri = this.generateResourceUri(resourceUrl, task.id);
      
      console.log(`🔄 插入任务: ${task.title}`);
      console.log(`📍 资源URL: ${resourceUrl}`);
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

      // 对资源文件执行 PATCH 操作（不是容器）
      const response = await this.session.fetch(resourceUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/sparql-update',
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
        
        // 如果资源不存在，尝试创建
        if (response.status === 404) {
          console.log(`🔄 资源不存在，尝试创建空资源文件...`);
          return await this.createResourceAndInsert(task);
        }
        
        return false;
      }
    } catch (error) {
      console.error(`❌ 插入任务时发生错误:`, error);
      return false;
    }
  }

  // 创建资源文件并插入数据
  private async createResourceAndInsert(task: TaskData): Promise<boolean> {
    try {
      const resourceUrl = this.getResourceUrl('tasks', 'data.ttl');
      const resourceUri = this.generateResourceUri(resourceUrl, task.id);
      
      // 创建 N3 Store 并添加数据
      const store = new Store();
      
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
      
      console.log(`📝 创建资源文件，Turtle 数据:`);
      console.log(turtleData);

      // 使用 PUT 创建新资源文件
      const response = await this.session.fetch(resourceUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/turtle',
          'Accept': 'text/turtle'
        },
        body: turtleData
      });

      if (response.ok) {
        console.log(`✅ 资源文件创建成功: ${response.status} ${response.statusText}`);
        return true;
      } else {
        const errorText = await response.text();
        console.error(`❌ 资源文件创建失败: ${response.status} ${response.statusText}`);
        console.error(`错误详情:`, errorText);
        return false;
      }
    } catch (error) {
      console.error(`❌ 创建资源文件时发生错误:`, error);
      return false;
    }
  }

  // 读取任务数据
  async readTasks(): Promise<TaskData[]> {
    try {
      const resourceUrl = this.getResourceUrl('tasks', 'data.ttl');
      console.log(`🔄 读取任务数据从: ${resourceUrl}`);

      const response = await this.session.fetch(resourceUrl, {
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
      const resourceUrl = this.getResourceUrl('tasks', 'data.ttl');
      const resourceUri = this.generateResourceUri(resourceUrl, taskId);
      
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

      // 对资源文件执行 PATCH 操作
      const response = await this.session.fetch(resourceUrl, {
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
  console.log('🚀 Solid 协议正确实现 Demo');
  console.log('============================================================');
  console.log('🔍 关键改进:');
  console.log('   • 对资源文件执行 PATCH，不是容器');
  console.log('   • 使用 PUT 创建新资源文件');
  console.log('   • 使用 N3.js 处理 RDF 数据');
  console.log('   • 遵循 Solid 协议规范');

  // 创建 Session
  const session = new Session();

  try {
    // 登录
    console.log('\n🔐 登录到 Solid Pod...');
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

    // 创建 Solid 协议客户端
    const client = new SolidProtocolClient(
      session,
      process.env.SOLID_OIDC_ISSUER!,
      session.info.webId!
    );

    // 测试数据
    const testTasks: TaskData[] = [
      {
        id: `task-${Date.now()}-1`,
        title: 'Solid 协议测试 1',
        description: '使用正确的资源文件操作',
        status: 'todo',
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: `task-${Date.now()}-2`,
        title: 'Solid 协议测试 2',
        description: '验证 N3.js + Solid 的完美结合',
        status: 'in-progress',
        priority: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    console.log('\n📝 CREATE 操作 - 对资源文件执行操作');
    console.log('============================================================');
    
    for (const task of testTasks) {
      const success = await client.insertTask(task);
      if (success) {
        console.log(`✅ 成功插入任务: ${task.title}`);
      } else {
        console.log(`❌ 插入任务失败: ${task.title}`);
      }
    }

    console.log('\n📖 READ 操作 - 使用 N3.js 解析 RDF');
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

    console.log('\n🎉 Solid 协议正确实现 Demo 完成！');
    console.log('============================================================');
    console.log('✅ 最终结论:');
    console.log('   • Solid Pod 原生支持 SPARQL UPDATE 操作');
    console.log('   • 必须对资源文件而不是容器执行 PATCH');
    console.log('   • N3.js 是处理 RDF 数据的优秀工具');
    console.log('   • 可以完全绕过 Comunica，直接使用 N3.js + HTTP');
    console.log('   • drizzle-solid 应该采用这种方式！');

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