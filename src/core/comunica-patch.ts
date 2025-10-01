// Comunica 兼容性补丁
// 修复 ActionObserverHttp 中 observedActors 未定义的问题

// 直接修补所有 Comunica 的 ActionObserverHttp 类
const patchActionObserverHttp = (moduleName: string) => {
  try {
    const comunica = require(moduleName);
    
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
    console.warn(`[Patch] Failed to patch ActionObserverHttp in ${moduleName}:`, error);
    return false;
  }
};

// 修补所有可能的 ActionObserverHttp 实例
const modules = [
  '@comunica/actor-query-result-serialize-sparql-json',
  '@comunica/actor-query-result-serialize-stats'
];

modules.forEach(patchActionObserverHttp);



export {};