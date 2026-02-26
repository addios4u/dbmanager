import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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
  external: ['vscode', 'better-sqlite3'],
  logLevel: 'warning',
  // esbuild가 @dbmanager/shared를 번들에 포함하도록 external에 넣지 않음
};

async function main() {
  const ctx = await esbuild.context(buildOptions);
  if (watch) {
    await ctx.watch();
    console.log('[esbuild] Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
