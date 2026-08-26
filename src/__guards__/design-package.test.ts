// @vitest-environment node
//
// What the published @yeaboi-ai/design actually contains.
//
// The desktop app compiles these files with its own bundler, so a file the
// closure missed is not a build error there — it is a warning nobody reads and
// a chrome that quietly falls back. Vite inlines this repo's own `url()` assets
// as data URIs, which is exactly why nothing else notices.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'dist-design');

beforeAll(() => {
  execFileSync('node', ['scripts/pack-design.mjs'], { cwd: ROOT, stdio: 'pipe' });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('the packed design system', () => {
  it('carries every file its own code references', () => {
    // Both edge kinds: a module specifier and a stylesheet url(). The second is
    // the one that was missing — `fonts.css` shipped without its three faces, so
    // the desktop rendered in the system stack.
    const dangling: string[] = [];
    for (const file of walk(OUT)) {
      if (!/\.(ts|tsx|css)$/.test(file)) continue;
      const text = readFileSync(file, 'utf-8');
      const specs = [
        ...text.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g),
        ...text.matchAll(/url\(\s*['"]?(\.[^'")]+)['"]?\s*\)/g),
      ].map(([, spec]) => spec!.split('?')[0]!);

      for (const spec of specs) {
        const base = resolve(dirname(file), spec);
        const found = [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          `${base}.css`,
          join(base, 'index.ts'),
        ].some((candidate) => existsSync(candidate));
        if (!found) dangling.push(`${relative(OUT, file)} -> ${spec}`);
      }
    }
    expect(
      dangling,
      `published files reference something that is not published:\n${dangling.join('\n')}`,
    ).toEqual([]);
  });

  it('declares every directory it wrote', () => {
    // `files` gates what npm uploads. A new top-level directory in the closure
    // that is not listed here is dropped at publish time, and the package
    // installs a module short.
    const pkg = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf-8'));
    const written = new Set(
      readdirSync(OUT).filter((name) => statSync(join(OUT, name)).isDirectory()),
    );
    expect(new Set(pkg.files)).toEqual(written);
  });
});
