/**
 * Assert the built bundles are shippable, before anything publishes them.
 *
 * These properties are also checked in the `yeaboi` repo, against the
 * *installed* package — which is the authoritative check, because it sees what
 * actually shipped. This one runs here for a different reason: it catches the
 * same mistake a release earlier, on the build that is about to become a wheel,
 * rather than after somebody has already `pip install`ed it.
 *
 * Every rule below is a deployment constraint, not a preference. An exported
 * report is opened over `file://`, where a `type="module"` script does not
 * execute at all and no request can succeed; a tunnel-served board runs under a
 * CSP with no `eval` and no external origins. Both failure modes are invisible
 * on localhost and on a LAN.
 *
 * Usage: node scripts/check-dist.mjs   (after `npm run build`)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENTRIES } from '../entries.mjs';

const STATIC = resolve(dirname(fileURLToPath(import.meta.url)), '../yeaboi_web_assets/static');

/** The footer byline. A place to go, not something the page loads. */
const CREDIT_URL = 'https://yeaboi.ai';

const failures = [];
const fail = (message) => failures.push(message);

const read = (name) => readFileSync(resolve(STATIC, name), 'utf-8');

// Nothing but bundles: a stray index.html or .map here would be packaged.
let present;
try {
  present = readdirSync(STATIC);
} catch {
  console.error(`✗ no build output at ${STATIC} — run: npm run build`);
  process.exit(1);
}
const stray = present.filter((n) => !/\.(js|css)$/.test(n));
if (stray.length) fail(`unexpected files in the wheel payload: ${stray.join(', ')}`);

// Two-way: an entry added to entries.mjs is covered here for free, and a file
// on disk that no entry claims is a leftover from a rename.
const expected = Object.keys(ENTRIES).sort();
const onDisk = present
  .filter((n) => n.endsWith('.js'))
  .map((n) => n.replace(/\.js$/, ''))
  .sort();
if (expected.join() !== onDisk.join()) {
  fail(`built entries ${onDisk.join(', ')} do not match entries.mjs (${expected.join(', ')})`);
}

for (const entry of expected) {
  for (const ext of ['js', 'css']) {
    const name = `${entry}.${ext}`;
    if (!present.includes(name)) {
      fail(`${name} is missing`);
      continue;
    }
    if (readFileSync(resolve(STATIC, name)).length === 0) fail(`${name} is empty`);
  }
  if (!present.includes(`${entry}.js`)) continue;

  const js = read(`${entry}.js`);

  for (const forbidden of ['eval(', 'new Function(', "setTimeout('", 'setTimeout("']) {
    if (js.includes(forbidden))
      fail(`${entry}.js contains ${forbidden} — blocked by the tunnel CSP`);
  }

  // The credit link is exempt by blanking a SINGLE occurrence, so a second
  // appearance — which is what an <img src> or a real fetch would look like —
  // still fails. Widening the pattern instead would remove the guard's teeth.
  const withoutCredit = js.replace(`"${CREDIT_URL}"`, '""');
  if (/https?:\/\/(?!www\.w3\.org)/.test(withoutCredit)) {
    fail(`${entry}.js references an external URL`);
  }
  if (js.includes('import(')) fail(`${entry}.js uses dynamic import — that emits a second file`);
  if (js.includes('importScripts')) fail(`${entry}.js uses importScripts`);
  if (!js.includes(CREDIT_URL))
    fail(`${entry}.js has no credit link — the carve-out above exempts nothing`);

  const head = js.trimStart();
  if (!/^(\(function|\(\(\)=>|!function)/.test(head)) {
    fail(`${entry}.js is not an IIFE — a type="module" script does not execute over file://`);
  }
  if (/^\s*(import|export)\s/m.test(js))
    fail(`${entry}.js has top-level import/export — wrong output format`);

  const css = read(`${entry}.css`);
  if (css.includes('@import')) fail(`${entry}.css uses @import`);
  if (/url\(\s*['"]?https?:/.test(css)) fail(`${entry}.css references an external URL`);
}

if (failures.length) {
  console.error('✗ built bundles are not shippable:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${expected.length} bundles are self-contained and shippable`);
