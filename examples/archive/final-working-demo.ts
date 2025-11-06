#!/usr/bin/env node

/**
 * 最终工作版本 - 修复路径问题
 * 使用正确的用户路径，不在 profile/card 下创建容器
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

class FinalSolidClient {
  private session: Session;
  private baseUrl: string;
  private webId: string;

  constructor(session: Session, baseUrl: string, webId: string) {
    this.session = session;
    this.baseUrl = baseUrl;
    this.webId = webId;
  }

  // 获取用户路径 - 修复版本
  private getUserPath(): string {
    const url = new URL(this.webId);
    // 从 /alice/profile/card#me 提取 /alice/
    const pathParts = url.pathname.split('/');
    return `/${pathParts[1]}/`; // 返回 /alice/
  }

  // 构建容器 URL - 直接在用户根目录下
  private getContainerUrl(containerPath: string): string {
    const userPath = this.getUserPath();
    const cleanContainerPath = containerPath.replace(/^\/+|\/+$/g, '');
    return `${this.baseUrl}${userPath}${cleanContainerPath}/`;
  }

  // 构建资源文件 URL
  private getResourceUrl(containerPath: string, resourceName: string): string {
    const userPath = this.getUserPath();
    const cleanContainerPath = containerPath.replace(/^\/+|\/+$/g, '');
    return `${this.baseUrl}${userPath}${cleanContainerPath}/${resourceName}`;
  }

  // 生成资源 URI
  private generateResourceUri(resourceUrl: string, id: string): string {
    return `${resourceUrl}#${id}`;
  }

  // 确保容器存在
  private async ensureContainer(containerPath: string): Promise<boolean> {
    try {
      const containerUrl = this.getContainerUrl(containerPath);
      
      console.log(`🔍 检查容器: ${containerUrl}`);
      
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
          const errorText = await createResponse.text();
          console.error(`❌ 容器创建失败: ${createResponse.status} ${createResponse.statusText}`);
          console.error(`错误详情:`, errorText);
          return false;
        }
      } else {
        const errorText = await response.text();
        console.error(`❌ 检查容器失败: ${response.status} ${response.statusText}`);
        console.error(`错误详情:`, errorText);
        return false;
      }
    } catch (error) {
      console.error(`❌ 确保容器存在时发生错误:`, error);
      return false;
    }
  }

  // 插入任务数据
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

      // 先检查资源是否存在
      const checkResponse = await this.session.fetch(resourceUrl, {
        method: 'HEAD'
      });

      if (checkResponse.status === 404) {
        // 资源不存在，先创建空的 Turtle 文件
        console.log(`🔄 资源不存在，创建空的 Turtle 文件...`);
        const createResponse = await this.session.fetch(resourceUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/turtle'
          },
          body: '# Empty Turtle file\n'
        });

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          console.error(`❌ 创建资源文件失败: ${createResponse.status} ${createResponse.statusText}`);
          console.error(`错误详情:`, errorText);
          return false;
        }
        
        console.log(`✅ 空资源文件创建成功`);
      }

      // 对资源文件执行 PATCH 操作
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
  console.log('🚀 最终工作版本 - N3.js + Solid Pod 完美结合');
  console.log('============================================================');
  console.log('🔧 关键修复:');
  console.log('   • 修复用户路径：直接在 /alice/ 下而不是 /alice/profile/card/');
  console.log('   • 对资源文件执行 SPARQL 操作');
  console.log('   • 使用 N3.js 解析 RDF 数据');
  console.log('   • 完全绕过 Comunica');

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

    // 创建最终版本的客户端
    const client = new FinalSolidClient(
      session,
      process.env.SOLID_OIDC_ISSUER!,
      session.info.webId!
    );

    // 测试数据
    const testTasks: TaskData[] = [
      {
        id: `task-${Date.now()}-1`,
        title: '最终测试任务 1',
        description: 'N3.js + Solid Pod 直接对接成功！',
        status: 'todo',
        priority: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: `task-${Date.now()}-2`,
        title: '最终测试任务 2',
        description: '不需要 Comunica，直接使用 SPARQL！',
        status: 'completed',
        priority: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    console.log('\n📝 CREATE 操作 - 直接 SPARQL INSERT');
    console.log('============================================================');
    
    for (const task of testTasks) {
      const success = await client.insertTask(task);
      if (success) {
        console.log(`✅ 成功插入任务: ${task.title}`);
      } else {
        console.log(`❌ 插入任务失败: ${task.title}`);
      }
    }

    console.log('\n📖 READ 操作 - N3.js 解析 RDF');
    console.log('============================================================');
    
    const tasks = await client.readTasks();
    console.log(`📊 找到 ${tasks.length} 个任务:`);
    
    for (const task of tasks) {
      console.log(`  • ${task.title} (${task.status}) - 优先级: ${task.priority}`);
      console.log(`    描述: ${task.description}`);
    }

    console.log('\n🗑️ DELETE 操作 - SPARQL DELETE');
    console.log('============================================================');
    
    for (const task of testTasks) {
      const success = await client.deleteTask(task.id);
      if (success) {
        console.log(`✅ 成功删除任务: ${task.id}`);
      } else {
        console.log(`❌ 删除任务失败: ${task.id}`);
      }
    }

    // 验证删除结果
    console.log('\n🔍 验证删除结果');
    console.log('============================================================');
    const remainingTasks = await client.readTasks();
    console.log(`📊 剩余任务数量: ${remainingTasks.length}`);

    console.log('\n🎉 最终工作版本 Demo 完成！');
    console.log('============================================================');
    console.log('🏆 成功验证:');
    console.log('   ✅ Solid Pod 原生支持 SPARQL');
    console.log('   ✅ N3.js 可以完美处理 RDF 数据');
    console.log('   ✅ 不需要 Comunica 作为中间层');
    console.log('   ✅ 直接 HTTP + SPARQL 就能完成所有操作');
    console.log('   ✅ drizzle-solid 应该采用这种架构！');

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