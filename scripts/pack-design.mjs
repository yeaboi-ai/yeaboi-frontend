/**
 * Assemble the `@yeaboi-ai/design` npm package from this repo's design system.
 *
 * The desktop app draws its chrome from the same primitives the boards do. It
 * used to reach them by relative path into a sibling directory of the monorepo;
 * with the two in separate repos it installs them instead.
 *
 * **Source is published, not a build.** The consumer resolves these files
 * through a Vite alias, which compiles them exactly as it compiled them in
 * place — so shipping the sources changes where the files are and nothing else.
 * A tsup/rollup step here would introduce a second compiler, and with it a class
 * of difference between what the desktop builds and what the boards build.
 *
 * `src/` is flattened to the package root, which is what keeps every relative
 * import inside the closure resolving unchanged: `design/primitives/Duck.tsx`
 * still reaches `../../assets/duck/base.png`, now at the package root.
 *
 * The closure is computed, not listed. A primitive that starts importing
 * something new either comes along or fails loudly here — a hand-maintained
 * file list would instead publish a package that is missing a module, and the
 * failure would land in the desktop's build.
 *
 * A stylesheet's `url()` is an edge of that graph too. Vite inlines those as
 * data URIs when it builds this repo's own bundles, so nothing here notices a
 * font left behind; the consumer compiles the same CSS with the file missing and
 * gets a warning it will never read, then ships the system font stack.
 *
 * Usage:
 *   node scripts/pack-design.mjs             # assemble into dist-design/
 *   node scripts/pack-design.mjs --version X # ...and stamp that version
 */

import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist-design');

const IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
const CSS_URL = /url\(\s*['"]?(\.[^'")]+)['"]?\s*\)/g;
const CODE = new Set(['.ts', '.tsx', '.css']);

/** Resolve a relative specifier the way the bundler does. */
function resolveSpec(from, spec) {
  // Vite's `?asset` / `?url` suffixes are instructions to the bundler, not part
  // of the path.
  const base = resolve(dirname(from), spec.split('?')[0]);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.css`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Every file reachable from `src/design`, tests excluded. */
function closure() {
  const seen = new Set();
  const queue = [];
  const walk = (dir) => {
    for (const entry of readdirRecursive(dir)) {
      if (entry.endsWith('.test.tsx') || entry.endsWith('.test.ts')) continue;
      queue.push(entry);
    }
  };
  walk(join(SRC, 'design'));

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const ext = file.slice(file.lastIndexOf('.'));
    if (!CODE.has(ext)) continue;

    const text = readFileSync(file, 'utf-8');
    const specs = [...text.matchAll(IMPORT), ...(ext === '.css' ? text.matchAll(CSS_URL) : [])];
    for (const [, spec] of specs) {
      const target = resolveSpec(file, spec);
      if (!target) {
        throw new Error(`${relative(ROOT, file)} references ${spec}, which resolves to nothing`);
      }
      queue.push(target);
    }
  }
  return [...seen].sort();
}

function readdirRecursive(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...readdirRecursive(full));
    else out.push(full);
  }
  return out;
}

const version = (() => {
  const i = process.argv.indexOf('--version');
  return i === -1 ? null : process.argv[i + 1];
})();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const files = closure();
for (const file of files) {
  const rel = relative(SRC, file);
  if (rel.startsWith('..'))
    throw new Error(`${rel} is outside src/ — the flattening assumption breaks`);
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(file, dest);
}

const repoPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const pkg = {
  name: '@yeaboi-ai/design',
  version: version ?? '0.0.0',
  description: "yeaboi's design system — tokens, palettes and primitives, as source",
  license: repoPkg.license ?? 'MIT',
  repository: repoPkg.repository,
  homepage: 'https://yeaboi.ai',
  type: 'module',
  // No `main` and no `exports`: consumers resolve these through a bundler alias
  // (`@design` -> node_modules/@yeaboi-ai/design/design), which is how the desktop
  // resolved them when they were a sibling directory. Nothing imports the
  // package root by name.
  files: ['design', 'runtime', 'types', 'assets'],
  // No dependencies and no peerDependencies. These files import "react", which
  // every consumer aliases to preact/compat — declaring a peer would make npm
  // demand a React that must never actually be installed.
  sideEffects: ['*.css'],
};
writeFileSync(join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

const readme = `# @yeaboi-ai/design

The design system behind [yeaboi](https://yeaboi.ai)'s browser surfaces — tokens, palettes and
primitives. Published as **source**, not a build: consumers compile it with their own bundler, which
is what keeps the desktop app and the web boards drawing from one compiler rather than two.

Generated from [yeaboi-frontend](https://github.com/yeaboi-ai/yeaboi-frontend) by
\`scripts/pack-design.mjs\`. Do not edit here — edit there.

Resolve it through a bundler alias rather than by package name:

\`\`\`ts
'@design': resolve('node_modules/@yeaboi-ai/design/design')
\`\`\`

It imports \`react\`, which every consumer aliases to \`preact/compat\`.
`;
writeFileSync(join(OUT, 'README.md'), readme);

console.log(`✓ ${files.length} files into dist-design/ as @yeaboi-ai/design@${pkg.version}`);
