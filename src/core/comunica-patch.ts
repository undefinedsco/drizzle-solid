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
const isAbsoluteModuleFilename = (value: string): boolean =>
  value.startsWith('file:') || value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);

const moduleFilename = typeof __filename === 'string' && isAbsoluteModuleFilename(__filename)
  ? __filename
  : (typeof process !== 'undefined' && typeof process.cwd === 'function'
      ? `${process.cwd().replace(/\/$/, '')}/package.json`
      : '/package.json');

const createDefaultRequireModule = (): NodeRequire | null => {
  if (!createRequireFn) {
    return null;
  }
  try {
    return createRequireFn(moduleFilename);
  } catch {
    return null;
  }
};

const defaultRequireModule = createDefaultRequireModule();

type ActionObserverHttpLike = {
  observedActors?: unknown[];
};

type OnRunHandler = (this: ActionObserverHttpLike, actor: unknown, action: unknown, output: unknown) => unknown;

const patchActionObserverHttp = (requireModule: NodeRequire | null, moduleName: string) => {
  if (!requireModule) {
    return false;
  }

  try {
    const comunica = requireModule(moduleName);

    if (comunica && comunica.ActionObserverHttp) {
      if (comunica.ActionObserverHttp.prototype.__drizzleSolidObservedActorsPatchApplied) {
        return true;
      }

      const originalOnRun = comunica.ActionObserverHttp.prototype.onRun as OnRunHandler;

      comunica.ActionObserverHttp.prototype.onRun = function(actor: unknown, _action: unknown, _output: unknown) {
        if (!this.observedActors || !Array.isArray(this.observedActors)) {
          this.observedActors = [];
        }

        return originalOnRun.call(this, actor, _action, _output);
      };

      comunica.ActionObserverHttp.prototype.__drizzleSolidObservedActorsPatchApplied = true;
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
