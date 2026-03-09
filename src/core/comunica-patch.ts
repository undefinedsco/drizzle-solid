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

const defaultRequireModule = createRequireFn
  ? createRequireFn(moduleFilename)
  : null;

const patchActionObserverHttp = (requireModule: NodeRequire | null, moduleName: string) => {
  if (!requireModule) {
    return false;
  }

  try {
    const comunica = requireModule(moduleName);

    if (comunica && comunica.ActionObserverHttp) {
      const originalOnRun = comunica.ActionObserverHttp.prototype.onRun;

      comunica.ActionObserverHttp.prototype.onRun = function(actor: any, _action: any, _output: any) {
        if (!this.observedActors || !Array.isArray(this.observedActors)) {
          this.observedActors = [];
        }

        return originalOnRun.call(this, actor, _action, _output);
      };

      console.log(`[Patch] Successfully patched ActionObserverHttp.onRun in ${moduleName}`);
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

export const applyComunicaPatches = (requireModule: NodeRequire | null = defaultRequireModule): boolean => {
  if (!requireModule) {
    return false;
  }

  const modules = [
    '@comunica/actor-query-result-serialize-sparql-json',
    '@comunica/actor-query-result-serialize-stats',
    '@comunica/query-sparql-solid/node_modules/@comunica/actor-query-result-serialize-sparql-json',
    '@comunica/query-sparql-solid/node_modules/@comunica/actor-query-result-serialize-stats'
  ];

  return modules
    .map((moduleName) => patchActionObserverHttp(requireModule, moduleName))
    .some(Boolean);
};

applyComunicaPatches();
