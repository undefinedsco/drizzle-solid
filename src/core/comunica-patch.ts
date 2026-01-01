// Comunica 兼容性补丁
// 修复 ActionObserverHttp 中 observedActors 未定义的问题

type NodeCreateRequire = (filename: string) => NodeRequire;

const resolveCreateRequire = (): NodeCreateRequire | null => {
  if (typeof window !== 'undefined') {
    return null;
  }

  try {
    const nodeRequire = eval('require') as NodeRequire | undefined;
    if (!nodeRequire) {
      return null;
    }

    const moduleLib = nodeRequire('module') as { createRequire?: NodeCreateRequire } | undefined;
    if (!moduleLib || typeof moduleLib.createRequire !== 'function') {
      return null;
    }

    return moduleLib.createRequire;
  } catch {
    return null;
  }
};

const createRequireFn = resolveCreateRequire();
const moduleFilename = typeof __filename === 'string'
  ? __filename
  : (typeof process !== 'undefined' && typeof process.cwd === 'function'
      ? process.cwd()
      : '/');

const requireModule = createRequireFn
  ? createRequireFn(moduleFilename)
  : null;

// 直接修补所有 Comunica 的 ActionObserverHttp 类
const patchActionObserverHttp = (moduleName: string) => {
  if (!requireModule) {
    return false;
  }

  try {
    const comunica = requireModule(moduleName);
    
    if (comunica && comunica.ActionObserverHttp) {
      const originalOnRun = comunica.ActionObserverHttp.prototype.onRun;
      
      comunica.ActionObserverHttp.prototype.onRun = function(actor: any, _action: any, _output: any) {
        // 确保 observedActors 存在且是数组
        if (!this.observedActors) {
          this.observedActors = [];
        }
        
        // observedActors 应该是一个数组，如果不是则初始化为空数组
        if (!Array.isArray(this.observedActors)) {
          this.observedActors = [];
        }
        
        // 调用原始方法
        return originalOnRun.call(this, actor, _action, _output);
      };
      
      console.log(`[Patch] Successfully patched ActionObserverHttp.onRun in ${moduleName}`);
      return true;
    }
    return false;
  } catch (error) {
    // 静默忽略模块不存在的错误
    return false;
  }
};

// 修补所有可能的 ActionObserverHttp 实例
// 包括顶层和 @comunica/query-sparql-solid 嵌套的 node_modules
if (requireModule) {
  const modules = [
    // 顶层模块
    '@comunica/actor-query-result-serialize-sparql-json',
    '@comunica/actor-query-result-serialize-stats',
    // 嵌套在 @comunica/query-sparql-solid 下的模块 (Comunica v4)
    '@comunica/query-sparql-solid/node_modules/@comunica/actor-query-result-serialize-sparql-json',
    '@comunica/query-sparql-solid/node_modules/@comunica/actor-query-result-serialize-stats'
  ];

  modules.forEach(patchActionObserverHttp);
}
