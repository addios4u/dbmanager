import * as esbuild from 'esbuild';
import { cpSync, readdirSync, realpathSync, rmSync, statSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Native/external modules that must be copied into dist/ for VSIX packaging
const nativeModules = ['better-sqlite3', 'ssh2', 'cpu-features'];

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode', ...nativeModules],
  logLevel: 'warning',
  // esbuild가 @dbmanager/shared를 번들에 포함하도록 external에 넣지 않음
};

/**
 * Copy external native modules AND all transitive dependencies into dist/node_modules/.
 * pnpm places a module's direct deps as siblings in the virtual store
 * (e.g. .pnpm/ssh2@1.17.0/node_modules/{ssh2,asn1,bcrypt-pbkdf,...}).
 * We recursively resolve each dependency's virtual store siblings to capture
 * transitive deps (e.g. bcrypt-pbkdf → tweetnacl).
 */
function copyNativeModules() {
  const require = createRequire(import.meta.url);
  const copied = new Set();          // package names already copied to dist/
  const visitedDirs = new Set();     // pnpm virtual store dirs already scanned
  // Queue of pnpm node_modules dirs to scan (e.g. .pnpm/ssh2@1.17.0/node_modules)
  const dirQueue = [];

  // Seed queue with the virtual store dirs of each top-level native module
  for (const mod of nativeModules) {
    try {
      const modPath = require.resolve(`${mod}/package.json`).replace('/package.json', '');
      const parentDir = dirname(modPath);
      if (parentDir.includes('.pnpm')) {
        dirQueue.push(parentDir);
      } else {
        // Standard node_modules — just copy the module itself
        const dest = `dist/node_modules/${mod}`;
        rmSync(dest, { recursive: true, force: true });
        cpSync(modPath, dest, { recursive: true, dereference: true });
        copied.add(mod);
      }
    } catch { /* module not installed */ }
  }

  // Packages that are only needed at install/build time, not at runtime.
  // These are pulled in by better-sqlite3's prebuild-install dependency chain.
  const buildTimeOnly = new Set([
    'prebuild-install', 'node-abi', 'napi-build-utils', 'detect-libc',
    'tar-fs', 'tar-stream', 'pump', 'end-of-stream', 'bl', 'readable-stream',
    'string_decoder', 'safe-buffer', 'inherits', 'util-deprecate', 'once', 'wrappy',
    'simple-get', 'simple-concat', 'decompress-response', 'mimic-response',
    'mkdirp-classic', 'fs-constants', 'chownr', 'tunnel-agent',
    'github-from-package', 'expand-template', 'ini', 'minimist', 'rc',
    'deep-extend', 'strip-json-comments', 'semver', 'buildcheck',
    'buffer', 'base64-js', 'ieee754',
  ]);

  // BFS over pnpm virtual store directories
  while (dirQueue.length > 0) {
    const dir = dirQueue.shift();
    if (visitedDirs.has(dir)) continue;
    visitedDirs.add(dir);

    for (const entry of readdirSync(dir)) {
      if (buildTimeOnly.has(entry)) continue;
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      // Copy files if not already done
      if (!copied.has(entry)) {
        const dest = `dist/node_modules/${entry}`;
        rmSync(dest, { recursive: true, force: true });
        cpSync(entryPath, dest, { recursive: true, dereference: true });
        copied.add(entry);
      }
      // Follow symlink to discover the dependency's own virtual store
      try {
        const realParent = dirname(realpathSync(entryPath));
        if (!visitedDirs.has(realParent)) dirQueue.push(realParent);
      } catch { /* ignore */ }
    }
  }
}

async function main() {
  const ctx = await esbuild.context(buildOptions);
  if (watch) {
    await ctx.watch();
    console.log('[esbuild] Watching for changes...');
  } else {
    await ctx.rebuild();
    copyNativeModules();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
