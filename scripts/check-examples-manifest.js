#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const strict = process.argv.includes('--strict');
const manifestPath = path.join(root, 'examples', 'manifest.json');
const packageJsonPath = path.join(root, 'package.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function listExampleEntries() {
  return fs.readdirSync(path.join(root, 'examples'))
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => name !== 'setup.ts')
    .map((name) => path.posix.join('examples', name))
    .sort();
}

function hasExport(source, exportName) {
  const patterns = [
    new RegExp(`export\\s+async\\s+function\\s+${exportName}\\b`),
    new RegExp(`export\\s+function\\s+${exportName}\\b`),
    new RegExp(`export\\s+const\\s+${exportName}\\b`),
    new RegExp(`export\\s*\\{[^}]*\\b${exportName}\\b[^}]*\\}`),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

function hasRequireMainGuard(source) {
  return source.includes('if (require.main === module)');
}

function hasTopLevelRunCall(source) {
  return /\brun\(\)\.catch\(/.test(source);
}

const manifest = readJson(manifestPath);
const pkg = readJson(packageJsonPath);
const scripts = pkg.scripts || {};
const exampleFiles = listExampleEntries();
const manifestEntries = manifest.examples || [];
const manifestByEntry = new Map(manifestEntries.map((entry) => [entry.entry, entry]));

const errors = [];
const warnings = [];

for (const file of exampleFiles) {
  if (!manifestByEntry.has(file)) {
    errors.push(`Missing manifest entry for ${file}`);
  }
}

for (const entry of manifestEntries) {
  if (!exists(entry.entry)) {
    errors.push(`Manifest entry ${entry.id} points to missing file: ${entry.entry}`);
    continue;
  }

  const source = read(entry.entry);

  if (entry.docs) {
    for (const doc of entry.docs) {
      if (!exists(doc)) {
        errors.push(`Manifest entry ${entry.id} references missing doc: ${doc}`);
      }
    }
  }

  if (entry.runnable?.script) {
    if (!scripts[entry.runnable.script]) {
      errors.push(`Manifest entry ${entry.id} references missing package script: ${entry.runnable.script}`);
    } else if (!scripts[entry.runnable.script].includes(path.basename(entry.entry))) {
      warnings.push(`Script ${entry.runnable.script} does not directly reference ${entry.entry}`);
    }
  }

  if (entry.runnable?.export && !hasExport(source, entry.runnable.export)) {
    errors.push(`Manifest entry ${entry.id} expects export '${entry.runnable.export}' in ${entry.entry}`);
  }

  if (entry.runnable?.mode === 'direct') {
    if (!hasRequireMainGuard(source)) {
      warnings.push(`Direct example ${entry.entry} is missing require.main guard`);
    }
    if (hasTopLevelRunCall(source) && !hasRequireMainGuard(source)) {
      errors.push(`Direct example ${entry.entry} appears to run on import; add require.main guard`);
    }
  }

  if (entry.verification?.path) {
    if (!exists(entry.verification.path)) {
      errors.push(`Manifest entry ${entry.id} references missing verification file: ${entry.verification.path}`);
    } else if (entry.verification.selector) {
      const verificationSource = read(entry.verification.path);
      if (!verificationSource.includes(entry.verification.selector)) {
        warnings.push(`Verification selector not found for ${entry.id}: ${entry.verification.selector}`);
      }
    }
  }

  if (strict && entry.audience === 'public' && entry.verification?.status !== 'covered') {
    errors.push(`Public example ${entry.id} is not fully covered (status=${entry.verification?.status || 'missing'})`);
  } else if (entry.audience === 'public' && entry.verification?.status !== 'covered') {
    warnings.push(`Public example ${entry.id} is not fully covered yet (status=${entry.verification?.status || 'missing'})`);
  }
}

const covered = manifestEntries.filter((entry) => entry.verification?.status === 'covered').length;
const pending = manifestEntries.filter((entry) => entry.verification?.status !== 'covered').length;

console.log(`Examples manifest: ${manifestEntries.length} entries, ${covered} covered, ${pending} pending`);

if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (errors.length > 0) {
  console.error('\nErrors:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('\nManifest check passed.');
