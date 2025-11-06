#!/usr/bin/env node

/**
 * Shim for Community Solid Server to satisfy Components.js context lookups
 * without hitting the network. It intercepts `fetch` requests that normally go
 * to https://linkedsoftwaredependencies.org/bundles/... and serves the
 * matching file from the local `node_modules` tree instead.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const PROJECT_ROOT = process.cwd();
let cssPackageRoot = null;

const runtimePackageJson = path.join(PROJECT_ROOT, 'node_modules', '@solid', 'community-server', 'package.json');
if (fs.existsSync(runtimePackageJson)) {
  cssPackageRoot = path.dirname(runtimePackageJson);
} else {
  try {
    cssPackageRoot = path.dirname(require.resolve('@solid/community-server/package.json'));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[css-context-shim] Could not resolve @solid/community-server package.json.', error);
  }
}

const SEARCH_ROOTS = [];

const originalNodeModulePaths = Module._nodeModulePaths;
Module._nodeModulePaths = function shimmedNodeModulePaths(from) {
  const paths = originalNodeModulePaths.call(this, from);
  return paths.filter((candidate) => candidate.startsWith(PROJECT_ROOT));
};

Module.globalPaths = Module.globalPaths.filter((candidate) => candidate.startsWith(PROJECT_ROOT));

const runtimeNodeModules = path.join(PROJECT_ROOT, 'node_modules');
const RUNTIME_RESOLUTION_PATHS = [runtimeNodeModules];
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function shimmedResolveFilename(request, parent, isMain, options) {
  if (request.startsWith('@comunica/') || request.startsWith('componentsjs')) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, { paths: RUNTIME_RESOLUTION_PATHS });
    } catch (error) {
      // Fallback to default resolution which may include additional paths.
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

function registerNestedNodeModules(baseDir) {
  if (!fs.existsSync(baseDir)) return;

  for (const entry of fs.readdirSync(baseDir)) {
    if (entry.startsWith('.')) continue;
    const full = path.join(baseDir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    if (entry.startsWith('@')) {
      for (const scoped of fs.readdirSync(full)) {
        const scopedPath = path.join(full, scoped);
        let scopedStat;
        try {
          scopedStat = fs.statSync(scopedPath);
        } catch {
          continue;
        }
        if (!scopedStat.isDirectory()) continue;
        const scopedModules = path.join(scopedPath, 'node_modules');
        if (fs.existsSync(scopedModules)) {
          SEARCH_ROOTS.push(scopedModules);
        }
      }
    }

    const nested = path.join(full, 'node_modules');
    if (fs.existsSync(nested)) {
      SEARCH_ROOTS.push(nested);
    }
  }
}

if (cssPackageRoot) {
  const cssModules = path.join(cssPackageRoot, 'node_modules');
  registerNestedNodeModules(cssModules);
  SEARCH_ROOTS.push(cssModules);
}

registerNestedNodeModules(path.join(PROJECT_ROOT, 'node_modules'));
SEARCH_ROOTS.push(path.join(PROJECT_ROOT, 'node_modules'));

const originalFetch = globalThis.fetch;
const { Response, Headers, Request } = globalThis;

if (typeof originalFetch !== 'function') {
  throw new Error('Expected global fetch to be available for CSS context shim');
}

const URL_PREFIX = 'https://linkedsoftwaredependencies.org/bundles/npm/';

function tryLoadFromCandidates(relativeSegments) {
  for (const root of SEARCH_ROOTS) {
    const candidate = path.join(root, ...relativeSegments);
    if (fs.existsSync(candidate)) {
      if (relativeSegments[0] === '@comunica' && relativeSegments[relativeSegments.length - 1] === 'ActorDereference.jsonld') {
        console.log('[css-context-shim] resolved', candidate);
      }
      return fs.readFileSync(candidate);
    }
  }

  return null;
}

function resolveLocalContextData(urlString) {
  if (!urlString.startsWith(URL_PREFIX)) {
    return null;
  }

  const { pathname } = new URL(urlString);
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .slice(2) // drop "bundles", "npm"
    .map((segment) => decodeURIComponent(segment));

  if (segments.length === 0) return null;

  let requestedVersion = null;
  const parts = [];
  for (const segment of segments) {
    if (segment.startsWith('^')) {
      requestedVersion = segment;
      continue;
    }
    parts.push(segment);
  }

  if (parts.length === 0) return null;

  const packageScope = parts[0].startsWith('@') ? parts[0] : null;

  const rewriteIfNeeded = (buffer) => {
    if (!buffer || !requestedVersion) return buffer;
    if (packageScope !== '@comunica' && packageScope !== 'componentsjs') {
      return buffer;
    }
    const data = buffer.toString('utf8');
    const rewritten = data
      .replace(/(@comunica\/[\w-]+\/)\^\d+\.\d+\.\d+/g, (_match, prefix) => `${prefix}${requestedVersion}`)
      .replace(/(componentsjs\/)\^\d+\.\d+\.\d+/g, (_match, prefix) => `${prefix}${requestedVersion}`);
    return Buffer.from(rewritten, 'utf8');
  };

  const loadCandidate = (candidateParts) => {
    const payload = tryLoadFromCandidates(candidateParts);
    return payload ? rewriteIfNeeded(payload) : null;
  };

  // Special case: componentsjs context paths sometimes end with context.jsonld
  if (parts[0] === 'componentsjs' && parts[1] === 'components') {
    const data = loadCandidate(parts);
    if (data) return data;
    const fallback = [...parts.slice(0, -1), 'context.json'];
    return loadCandidate(fallback);
  }

  const data = loadCandidate(parts);
  if (data) return data;

  // Retry with .json fallback if .jsonld was requested
  if (parts[parts.length - 1]?.endsWith('.jsonld')) {
    const fallback = [...parts.slice(0, -1), parts[parts.length - 1].replace(/\.jsonld$/, '.json')];
    return loadCandidate(fallback);
  }

  return null;
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : (typeof URL !== 'undefined' && input instanceof URL)
      ? input.href
      : (typeof Request !== 'undefined' && input instanceof Request)
        ? input.url
        : input?.url;

  if (typeof url === 'string' && url.startsWith(URL_PREFIX)) {
    const payload = resolveLocalContextData(url);
    if (payload) {
      return new Response(payload, {
        status: 200,
        headers: new Headers({ 'content-type': 'application/ld+json' }),
      });
    }
    throw new Error(`CSS context shim could not resolve local data for ${url}`);
  }

  return originalFetch(input, init);
};
