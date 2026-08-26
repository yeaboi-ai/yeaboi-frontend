# repo-notes — yeaboi-frontend

The facts `/ship` and `/sync-main` do not hardcode. Keep this short; anything longer than a page is
a skill, not a note.

## What this repo is

Every browser-facing surface of yeaboi — the retro and poker live boards, the share gate, the
reporting slide deck, the ship board, and the ten static HTML exports. Preact + TypeScript, Vite,
one `vite build --mode <name>` per entry in `entries.mjs` (rollup refuses IIFE with multiple inputs,
and IIFE is non-negotiable).

It publishes **`yeaboi-web-assets`** to PyPI: a data-only wheel of the built bundles. That is how
they reach a `pip install yeaboi` on a machine with no Node.

## Commit

No pre-commit hooks here — commit normally. Trailer:

```
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

## Gate

`make ship-gate` = `lint` → `format-check` → `test` → `build` → `contracts-check` → `tooling-check`
→ `dist-check` → `wheel-check`.

- **`lint` is `typecheck`.** No ESLint in this tree, and never was. `npm run typecheck` starts with
  `gen-enums --check`, so a stale `src/types/enums.ts` fails there rather than being type-checked
  against.
- **Prettier is real**, and `.prettierignore` matters: `contracts/` is vendored byte-for-byte, and
  `src/types/enums.ts` is generated — reformatting either makes a `--check` unsatisfiable. Markdown
  is excluded too; prettier reflows prose and cannot tell a hanging line from a bullet.
- **`wheel-check` is the one that matters most.** `.gitignore` doubles as hatchling's exclude list
  and this repo gitignores its build output, so the `artifacts` entry in `pyproject.toml` is the
  only thing putting the bundles in the wheel. Without it the wheel builds green, installs fine,
  and every board renders nothing.

## Two artifacts come from `yeaboi`

`contracts/web/` is **vendored** — `enums.json` and the wire `fixtures/` — pinned by sha in
`.contracts-rev`. Never edit anything under `contracts/`; `make contracts-check` fails on an
edited-in-place copy and prints a note (not a failure) when the pin is merely behind.

Changing a board tuple is a **`yeaboi` PR first**, then `make contracts-sync` + `make gen-enums`
here, in that order. `src/` reaches both through the `@contracts` alias, declared in
`vite.config.ts` *and* `tsconfig.json` — change both or `tsc` and the bundler resolve different
modules.

## Releasing

`.github/workflows/publish.yml`, PyPI trusted publishing (OIDC), no token anywhere.

- **The filename `publish.yml` is half the trusted-publisher record.** Renaming it revokes publish
  rights, and the failure reads as an auth error rather than a rename.
- A merge to `main` publishes when `version` in `pyproject.toml` names something PyPI does not have;
  every other merge ends at the `check` job.
- **Never commit a pre-release suffix.** `workflow_dispatch` with `suffix: rc1` stamps it at build
  time. A committed rc becomes the version `main` claims, and the next real release looks like a
  downgrade.

## Rebase conflicts

Nothing generated is committed here, so the monorepo's minified-bundle conflict playbook does not
apply. The two files worth care:

| Path | What to do |
|---|---|
| `package-lock.json` | Take upstream, then re-run `npm install` for your own change and commit the result |
| `src/types/enums.ts` | Take either side, then `make gen-enums` — it is generated, so neither side is authoritative |
| `contracts/**` | Take upstream, then `make contracts-sync` if you meant to move the pin |

## Developing against a running board

`make dev` is Vite with HMR proxying `/api`. To have the **Python** side serve this tree's build
instead, point a sibling `yeaboi` checkout at it — `web/assets.py` checks this before anything else:

```bash
make build
YEABOI_WEB_STATIC=../yeaboi-frontend/yeaboi_web_assets/static   # then yeaboi's `make dev-board`
```

It is read once at import, so restart the board after a rebuild.

## Clips

A clip here is `kind: "page"`. The repo's `demo_spec.py` is the example to copy — it already solves
the two things that go wrong.

**Film the real Python board, never the Vite shell.** `make dev` on :5399 serves `dev/retro.html`,
whose JSON island is a deliberately shortened stand-in for what `retro/page.py` actually emits, and
Vite injects its HMR client on top. What ships is what should be filmed:

```python
"serve": ["make", "dev-board"],      # yeaboi's board on :5173
"serve_cwd": "$YEABOI_REPO",         # set it with `eval "$(make workspace-env)"`
```

To film *this* tree's bundles rather than the installed wheel, build first and point the board at
the output — `web/assets.py` checks `YEABOI_WEB_STATIC` before anything else, and reads it once at
import, so the board must start after the build:

```python
"prepare": ["make", "build"],
"env": {"YEABOI_WEB_STATIC": "../yeaboi-frontend/yeaboi_web_assets/static"},
```

**Retro, not poker, unless poker is the point.** `dev_poker.py` re-announces its crew from a daemon
thread every two seconds, so its state moves under the recorder. The retro board is static until
touched, which is what makes a take repeatable. Seeded tokens are fixed (`dev-token`,
`dev-admin`) precisely so a recording does not invalidate the tab it is filming.

Prefer `await` on a selector over `pause`, and remember `type` uses `pressSequentially` — a UI that
reacts per keystroke is the thing worth showing.
