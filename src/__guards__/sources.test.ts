// @vitest-environment node
//
// Reads files off disk, so it needs Node rather than the suite's jsdom default.

/**
 * Static guards over these sources.
 *
 * Ported from the yeaboi repo's `tests/unit/test_web_frontend_guards.py`, which
 * enforced them from the Python suite while this tree lived in the monorepo.
 * Every rule here guards a failure that is silent in development and shows up
 * only for the remote teammate on the tunnel, or in a security review — so they
 * had to follow the sources rather than be left behind skipping.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(SRC, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const ALL = walk(SRC).sort();

/** Every source with one of `suffixes`; test files excluded by default. */
function sources(suffixes: string[], { tests = false } = {}): string[] {
  return ALL.filter((p) => {
    if (!suffixes.some((s) => p.endsWith(s))) return false;
    if (tests) return true;
    return !p.includes('.test.') && !p.split('\\').join('/').includes('/test/');
  });
}

const rel = (p: string) => relative(REPO, p).split('\\').join('/');
const read = (p: string) => readFileSync(p, 'utf-8');

/**
 * Where `pattern` matches, ignoring comment lines.
 *
 * These files document the very patterns they ban — CardView explains what
 * `innerHTML =` used to do and why it no longer has to, which is the most
 * useful comment in the file and also an exact match for the rule. A commented
 * mention cannot execute, so the guard loses nothing; rewording every
 * explanation around a grep would make the code worse to protect a test.
 */
function codeHits(pattern: RegExp, paths: string[]): string[] {
  const hits: string[] = [];
  for (const path of paths) {
    read(path)
      .split('\n')
      .forEach((line, i) => {
        const stripped = line.trimStart();
        if (stripped.startsWith('*') || stripped.startsWith('//') || stripped.startsWith('/*'))
          return;
        if (new RegExp(pattern.source, pattern.flags.replace('g', '')).test(line)) {
          hits.push(`${rel(path)}:${i + 1}`);
        }
      });
  }
  return hits;
}

describe('no raw HTML', () => {
  it('bans dangerouslySetInnerHTML outright', () => {
    // React escapes children, so every other path is safe by construction; this
    // attribute is the single documented way to opt out of that. The three
    // places someone will be tempted: the invite QR (keep `<img src=…>`),
    // ticket descriptions (already plain text — use `<Prose>`), and
    // standup's linkify (use the `Run[]` contract via `<RichText>`).
    expect(codeHits(/dangerouslySetInnerHTML/, sources(['.ts', '.tsx']))).toEqual([]);
  });

  it('bans assigning to innerHTML', () => {
    // The same hole with a different spelling — and how the entire pre-React
    // board rendered, so it is the habit most likely to come back.
    expect(codeHits(/\.innerHTML\s*=/, sources(['.ts', '.tsx']))).toEqual([]);
  });
});

describe('no eval', () => {
  it('does not eval, anywhere', () => {
    // The tunnel CSP has no 'unsafe-eval'. The bundle-level check in the yeaboi
    // repo catches a *dependency* reaching for it; this catches our own code,
    // and names the file rather than the minified blob.
    const pattern = /\beval\s*\(|new\s+Function\s*\(/;
    const offenders = sources(['.ts', '.tsx'], { tests: true })
      .filter((p) => pattern.test(read(p)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('one palette source', () => {
  // A `[data-theme="x"][data-mode="y"]` rule that sets nothing but `--accent`.
  //
  // The one legitimate reason to name a theme outside palette.css: the mode
  // accents are the TUI's terminal colours, tuned to glow on near-black and
  // unreadable as text on the light theme (retro's teal measured 2.09:1). The
  // fix is a darker rendition of the same hue per mode — a one-token override,
  // not a sixth palette. Requiring the body to be exactly one `--accent`
  // declaration means the only thing that fits is what this was opened for.
  const MODE_ACCENT_RULE =
    /\[data-theme="\w+"\]\[data-mode="\w+"\]\s*\{\s*--accent\s*:\s*[^;{}]+;?\s*\}/g;

  it('keeps theme blocks in palette.css alone', () => {
    const offenders = sources(['.css'])
      .filter((p) => !p.endsWith('palette.css'))
      // tokens.css may reference bare `[data-theme]` for the print override —
      // a selector over *any* theme, not a redefinition of one — and may carry
      // theme-scoped mode accents, which are stripped first.
      .filter((p) => /\[data-theme="\w+"\]/.test(read(p).replace(MODE_ACCENT_RULE, '')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('gives every mode accent a light rendition', () => {
    // A mode with no light override gets its terminal hue painted on white.
    const css = read(join(SRC, 'design', 'tokens.css'));
    const dark = new Set(
      [...css.matchAll(/(?<!\])\[data-mode="(\w+)"\]\s*\{[^}]*--accent/g)].map((m) => m[1]),
    );
    const light = new Set(
      [...css.matchAll(/\[data-theme="light"\]\[data-mode="(\w+)"\]/g)].map((m) => m[1]),
    );
    expect(dark.size).toBeGreaterThan(0);
    expect([...dark].sort()).toEqual([...light].sort());
  });

  it('keeps literal colours out of component styles', () => {
    // Component CSS may not hardcode a colour: it would not follow the theme.
    // Scoped to the component modules — palette.css *is* the colours, and
    // tokens.css carries the print override, which is deliberately fixed.
    const hex = /#[0-9a-fA-F]{3,8}\b/;
    const offenders: string[] = [];
    for (const path of sources(['.module.css'])) {
      read(path)
        .split('\n')
        .forEach((line, i) => {
          const stripped = line.trimStart();
          if (!hex.test(line) || stripped.startsWith('*') || stripped.startsWith('/*')) return;
          offenders.push(`${rel(path)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe('custom properties resolve', () => {
  // The quietest failure in the whole front end. An undefined custom property
  // makes the declaration invalid *at computed-value time*, so the browser does
  // not fall back and does not log — it drops that one declaration and paints
  // the rest of the rule. A panel keeps its max-width and border and loses
  // every padding, gap, border-radius and font-size, which reads as "someone
  // forgot to style this" rather than as a typo in a token name.
  //
  // Nothing else catches it: typecheck does not look inside a stylesheet, jsdom
  // does not resolve custom properties, and the bundle guards read for
  // self-containment rather than meaning. It shipped twice.
  //
  // Only the no-fallback form is an error. `var(--wordmark-block, 10px)` names
  // a property set from TypeScript at runtime and says what to do without it.

  // A declaration, not a use: `--x:` at the start of a line or after `{`/`;`.
  // palette.css puts five on one line, so this cannot be line-anchored, and the
  // leading `(` of a `var(` is what keeps a *use* from matching.
  const DECLARED = /(?:^|[;{])\s*(--[a-z0-9-]+)\s*:/gm;
  const SET_FROM_TS = /setProperty\(\s*['"`](--[a-z0-9-]+)/g;
  const USED_BARE = /var\(\s*(--[a-z0-9-]+)\s*\)/g;

  it('resolves every var() reference', () => {
    const declared = new Set<string>();
    for (const path of sources(['.css'])) {
      for (const m of read(path).matchAll(DECLARED)) declared.add(m[1]!);
    }
    for (const path of sources(['.ts', '.tsx'], { tests: true })) {
      for (const m of read(path).matchAll(SET_FROM_TS)) declared.add(m[1]!);
    }
    expect(
      declared.has('--s4'),
      'the declaration regex has rotted — it cannot see tokens.css',
    ).toBe(true);

    const offenders: string[] = [];
    // Stylesheets and TypeScript alike: an inline `style` string is a
    // stylesheet with no file extension, and the deck writes several.
    for (const path of sources(['.css', '.ts', '.tsx'])) {
      read(path)
        .split('\n')
        .forEach((line, i) => {
          const stripped = line.trimStart();
          if (stripped.startsWith('*') || stripped.startsWith('//') || stripped.startsWith('/*'))
            return;
          for (const m of line.matchAll(USED_BARE)) {
            if (!declared.has(m[1]!)) offenders.push(`${rel(path)}:${i + 1}: var(${m[1]})`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe('breakpoints', () => {
  // The numbers were never the problem — the missing convention was. Retro
  // wrote `max-width: 1099px` where poker wrote `max-width: 1100px`, so at
  // exactly 1100px the two boards took different branches on the same phone.

  /** `--bp-s/m/l` from tokens.css, each with its `calc(bp − 1px)` partner. */
  const ALLOWED = new Set([699, 700, 1099, 1100, 1439, 1440]);

  /**
   * Heights the same rule applies to. Only one query asks about height —
   * PageShell's hero-density switch — and it needs a viewport tall enough for
   * a ~250px masthead *and* a usable board, which no width token can say.
   */
  const ALLOWED_HEIGHTS = new Set([800]);

  it('keeps every stylesheet media query on the scale', () => {
    const pattern = /\((?:min|max)-width:\s*(\d+)px\)/g;
    const offenders: string[] = [];
    for (const path of sources(['.css'])) {
      read(path)
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(pattern)) {
            if (!ALLOWED.has(Number(m[1]))) offenders.push(`${rel(path)}:${i + 1}: ${m[1]}px`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('keeps matchMedia strings on the scale too', () => {
    // A `matchMedia` string is a media query no stylesheet scan sees. The query
    // deciding whether a board wears the hero masthead lives in PageShell.tsx,
    // so the convention stopped exactly where it mattered most.
    const pattern = /\((?:min|max)-(width|height):\s*(\d+)px\)/g;
    const offenders: string[] = [];
    for (const path of sources(['.ts', '.tsx'])) {
      read(path)
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(pattern)) {
            const allowed = m[1] === 'width' ? ALLOWED : ALLOWED_HEIGHTS;
            if (!allowed.has(Number(m[2])))
              offenders.push(`${rel(path)}:${i + 1}: ${m[1]} ${m[2]}px`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('declares the scale in tokens.css', () => {
    const tokens = read(join(SRC, 'design', 'tokens.css'));
    for (const [name, value] of [
      ['--bp-s', '700px'],
      ['--bp-m', '1100px'],
      ['--bp-l', '1440px'],
    ]) {
      expect(tokens).toContain(`${name}: ${value}`);
    }
  });
});
