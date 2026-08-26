<div align="center">

<img src="https://yeaboi.ai/banner.jpg" alt="yeaboi.ai" width="800"/>

# 🤙 yeaboi-frontend

**Every browser-facing surface of yeaboi — the retro and poker live boards, the share gate, the reporting slide deck, the supervised-ship board and the static HTML exports.**

[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![PyPI](https://img.shields.io/pypi/v/yeaboi-web-assets?style=for-the-badge&logo=pypi&logoColor=white&color=blue&label=yeaboi--web--assets)](https://pypi.org/project/yeaboi-web-assets/)
[![npm](https://img.shields.io/npm/v/@yeaboi-ai/design?style=for-the-badge&logo=npm&logoColor=white&label=%40yeaboi-ai%2Fdesign)](https://www.npmjs.com/package/@yeaboi-ai/design)
[![Part of yeaboi](https://img.shields.io/badge/part%20of-yeaboi-ff6600?style=for-the-badge)](https://github.com/yeaboi-ai/yeaboi.ai)

[![CI](https://img.shields.io/github/actions/workflow/status/yeaboi-ai/yeaboi-frontend/ci.yml?style=for-the-badge&label=CI&logo=github)](https://github.com/yeaboi-ai/yeaboi-frontend/actions)

</div>

---

<div align="center">
<img src="https://yeaboi.ai/demo-frontend.gif" alt="A yeaboi retro board in a browser — joining the room as Ada, ten seeded cards landing across the four grids, then a new action item typed and added live" width="800"/>

*The retro board, live. `make demo` re-records this from `demo_spec.py`.*
</div>

---

## What this is

Preact + TypeScript, built with Vite, and one of **five repos that make one product**:
[yeaboi](https://github.com/yeaboi-ai/yeaboi.ai) (the Python — engines, TUI, CLI, MCP),
this one, [yeaboi-desktop](https://github.com/yeaboi-ai/yeaboi-desktop),
[yeaboi-site](https://github.com/yeaboi-ai/yeaboi-site) and
[yeaboi-tooling](https://github.com/yeaboi-ai/yeaboi-tooling).

Published to PyPI as **`yeaboi-web-assets`** — a data-only wheel holding one `.js` and one `.css` per
entry. That is how the bundles reach a `pip install yeaboi` on a machine with no Node. The design
system goes out separately, as **`@yeaboi-ai/design`** on npm, which is what the desktop shell draws
its chrome from.

```bash
make install       # npm ci
make dev           # Vite on :5399 with HMR, proxying /api to a yeaboi dev board
make test          # typecheck (incl. the enums --check) + vitest
make build         # the six bundles, into yeaboi_web_assets/static/
make ship-gate     # the full local gate: lint, format-check, test, build, contracts, wheel
```

## The bundles are self-contained, and that is not a style rule

No CDN, no external `<link>`, no `eval`/`new Function`, no dynamic `import()`, classic IIFE rather
than ESM. An exported report is opened over `file://`, where a `type="module"` script does not
execute at all, and a tunnel-served board runs under a CSP with no external origins and no `eval`.
Both failures are invisible on localhost and on a LAN; they show up only for the teammate on the
tunnel or the person who opens a report from disk months later.

`vite.config.ts` is written to enforce this (`cssCodeSplit: false`, `modulePreload: false`, an
`assetsInlineLimit` high enough that every asset becomes a `data:` URI). The assertions live in the
`yeaboi` repo's `tests/unit/test_web_assets.py`, which runs them against **whatever is actually
installed** — so what is checked is what ships, not what this repo happened to build.

## Two artifacts come from `yeaboi`, and neither is edited here

`contracts/web/` is vendored from [`yeaboi`](https://github.com/yeaboi-ai/yeaboi.ai) and pinned by
sha in `.contracts-rev`. `make contracts-check` fails if a vendored file was edited in place, and
notes when the pin has fallen behind upstream.

- **`enums.json`** — the tuples the server validates against (retro grids, reaction emoji, avatars,
  the poker deck, evidence sources, the two terminal fonts). `scripts/gen-enums.mjs` renders
  `src/types/enums.ts` from it; `npm run typecheck` runs `--check` first, so a stale file fails
  before anything reads it. **Never edit `src/types/enums.ts`.**
- **`fixtures/`** — snapshots of what the server actually sends, written by a Python test that drives
  real boards through a real round. `src/test/fixtures/wire.ts` asserts each one `satisfies` its
  interface in `types/board.ts`, so a response field that quietly stopped being sent fails the
  typecheck here rather than rendering `undefined` to somebody on a tunnel.

Both are reached through the `@contracts` alias — declared in `vite.config.ts` and `tsconfig.json`,
which must agree. Changing a board tuple is a `yeaboi` PR first, then `make contracts-sync` here.

```bash
make contracts-sync   # re-vendor from the tip of yeaboi, record the sha
make gen-enums        # re-render src/types/enums.ts from the vendored contract
```

## Releasing

`.github/workflows/publish.yml` publishes to PyPI over **trusted publishing (OIDC)** — no token,
nothing to rotate. It fires when a merge to `main` carries a `version` in `pyproject.toml` that PyPI
does not already have. `workflow_dispatch` with a `suffix` input (`rc1`) builds a pre-release without
committing the suffix anywhere.

The wheel is built from bundles produced moments earlier in the same job; **the build output is not
committed**. `make wheel-check` builds the real wheel, installs it into a throwaway environment and
resolves the files the way `yeaboi` does — because `.gitignore` doubles as hatchling's exclude list,
and a missing `artifacts` entry would ship an empty wheel that installs perfectly and renders
nothing. `make dist-check` asserts the self-contained rules on the same build, one release earlier
than the `yeaboi` side can.

## Development against a running board

The Python side finds bundles through `$YEABOI_WEB_STATIC` before anything else, so a sibling
`yeaboi` checkout can serve this tree's build with nothing published:

```bash
make build
YEABOI_WEB_STATIC=../yeaboi-frontend/yeaboi_web_assets/static  # then run yeaboi's `make dev-board`
```

`make dev` is the faster loop when only the front end is changing — Vite's own server with HMR,
proxying `/api` to whichever board is running.

## Known gaps

No ESLint. This tree never had one; with strict TypeScript on, `tsc --noEmit` is what rejects code,
and `npm run lint` says so rather than pretending otherwise. Prettier is real.

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
