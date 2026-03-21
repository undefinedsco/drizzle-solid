#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const esmRoot = path.resolve(__dirname, '../dist/esm');

function walkJavaScriptFiles(rootDir, files = []) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkJavaScriptFiles(entryPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }
  return files;
}

function resolvePatchedSpecifier(filePath, specifier) {
  if (/\.(?:[cm]?js|json)$/.test(specifier)) {
    return specifier;
  }

  const absoluteTarget = path.resolve(path.dirname(filePath), specifier);
  if (fs.existsSync(`${absoluteTarget}.js`)) {
    return `${specifier}.js`;
  }
  if (fs.existsSync(path.join(absoluteTarget, 'index.js'))) {
    return `${specifier}/index.js`;
  }
  return `${specifier}.js`;
}

function rewriteRelativeImportSpecifiers(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const rewrite = (_match, prefix, specifier, suffix) => (
    `${prefix}${resolvePatchedSpecifier(filePath, specifier)}${suffix}`
  );

  const rewritten = source
    .replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, rewrite)
    .replace(/(import\s+['"])(\.\.?\/[^'"]+?)(['"])/g, rewrite)
    .replace(/(import\(\s*['"])(\.\.?\/[^'"]+?)(['"]\s*\))/g, rewrite);

  if (rewritten !== source) {
    fs.writeFileSync(filePath, rewritten);
  }
}

function ensureEsmPackageJson() {
  const packageJsonPath = path.join(esmRoot, 'package.json');
  fs.writeFileSync(packageJsonPath, JSON.stringify({ type: 'module' }, null, 2) + '\n');
}

function main() {
  if (!fs.existsSync(esmRoot)) {
    throw new Error(`ESM output directory not found: ${esmRoot}`);
  }

  for (const filePath of walkJavaScriptFiles(esmRoot)) {
    rewriteRelativeImportSpecifiers(filePath);
  }

  ensureEsmPackageJson();
  console.log(`[fix-esm-imports] patched ${esmRoot}`);
}

main();
