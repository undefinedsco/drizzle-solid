import { applyComunicaPatches } from './comunica-patch';

export type SPARQLBindingsStream = {
  toArray(): Promise<unknown[]>;
};

export interface SPARQLQueryEngine {
  queryBindings(query: string, context: Record<string, unknown>): Promise<SPARQLBindingsStream>;
  queryBoolean(query: string, context: Record<string, unknown>): Promise<boolean>;
  invalidateHttpCache?: (url?: string) => Promise<void>;
}

export type SPARQLQueryEngineFactory = () => SPARQLQueryEngine | Promise<SPARQLQueryEngine>;

export interface SPARQLEngineConfig {
  createQueryEngine?: SPARQLQueryEngineFactory;
}

type NodeCreateRequire = (filename: string) => NodeRequire;

type ComunicaModule = {
  QueryEngine: new () => SPARQLQueryEngine;
};

let configuredQueryEngineFactory: SPARQLQueryEngineFactory | null = null;

const resolveCreateRequire = async (): Promise<NodeCreateRequire | null> => {
  if (typeof window !== 'undefined') {
    return null;
  }

  try {
    const nodeRequire = eval('require') as NodeRequire | undefined;
    if (nodeRequire) {
      const moduleLib = nodeRequire('module') as { createRequire?: NodeCreateRequire } | undefined;
      if (moduleLib && typeof moduleLib.createRequire === 'function') {
        return moduleLib.createRequire;
      }
    }
  } catch {
    // ignore and fall back to dynamic import below
  }

  try {
    const moduleLib = await import('node:module');
    if (typeof moduleLib.createRequire === 'function') {
      return moduleLib.createRequire as NodeCreateRequire;
    }
  } catch {
    // ignore
  }

  return null;
};

const buildMissingComunicaError = (reason?: unknown): Error => {
  const suffix = reason instanceof Error && reason.message
    ? ` Original error: ${reason.message}`
    : '';

  return new Error(
    'A SPARQL query engine is required for this operation. ' +
    'Install `@comunica/query-sparql-solid` in the consuming app, ' +
    'or provide `sparql.createQueryEngine` to `drizzle(...)`, ' +
    'or call `configureSparqlEngine(...)` before executing LDP/SPARQL-client queries.' +
    suffix
  );
};

const loadComunicaModuleWithRequire = async (resolveFrom: string): Promise<ComunicaModule> => {
  const createRequire = await resolveCreateRequire();
  if (!createRequire) {
    throw new Error('Node module resolution is not available in this runtime.');
  }

  const requireFrom = createRequire(resolveFrom);
  applyComunicaPatches(requireFrom);
  const comunicaModule = requireFrom('@comunica/query-sparql-solid') as Partial<ComunicaModule>;

  if (!comunicaModule || typeof comunicaModule.QueryEngine !== 'function') {
    throw new Error('Resolved module does not export QueryEngine.');
  }

  return comunicaModule as ComunicaModule;
};

const loadDefaultComunicaModule = async (): Promise<ComunicaModule> => {
  try {
    return await loadComunicaModuleWithRequire(
      typeof __filename === 'string'
        ? __filename
        : (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '/')
    );
  } catch (requireError) {
    try {
      applyComunicaPatches();
      const importedModule = await import('@comunica/query-sparql-solid') as Partial<ComunicaModule>;
      if (importedModule && typeof importedModule.QueryEngine === 'function') {
        return importedModule as ComunicaModule;
      }
    } catch (importError) {
      throw buildMissingComunicaError(importError ?? requireError);
    }

    throw buildMissingComunicaError(requireError);
  }
};

const createDefaultQueryEngine: SPARQLQueryEngineFactory = async () => {
  const comunicaModule = await loadDefaultComunicaModule();
  return new comunicaModule.QueryEngine();
};

export const configureSparqlEngine = (config?: SPARQLEngineConfig | null): void => {
  configuredQueryEngineFactory = config?.createQueryEngine ?? null;
};

export const getConfiguredSparqlEngineFactory = (
  createQueryEngine?: SPARQLQueryEngineFactory | null
): SPARQLQueryEngineFactory => {
  return createQueryEngine ?? configuredQueryEngineFactory ?? createDefaultQueryEngine;
};

export const createNodeModuleSparqlEngineFactory = (
  resolveFrom: string
): SPARQLQueryEngineFactory => {
  return async () => {
    const comunicaModule = await loadComunicaModuleWithRequire(resolveFrom);
    return new comunicaModule.QueryEngine();
  };
};
