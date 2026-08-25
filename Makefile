# --- shared tooling (yeaboi-tooling, pinned by .tooling-rev) ------------------
#
# Copied verbatim from the tooling repo's bootstrap/Makefile.head. It clones the
# tooling repo to `.tooling/` at the pinned sha and includes the shared targets
# (wt-*, tooling-*, contracts-*). The clone happens at parse time and only when
# the pin and the checkout disagree, so the steady state is two file reads and
# no network — and a fresh `git worktree add`, which never populates a
# submodule, provisions itself on the first `make`.
#
# Bump the pin with `make tooling-bump` and commit `.tooling-rev`.

TOOLING      := .tooling
TOOLING_REV  := $(shell cat .tooling-rev 2>/dev/null | tr -d '[:space:]')
TOOLING_HAVE := $(shell cat $(TOOLING)/.git/tooling-rev 2>/dev/null | tr -d '[:space:]')

ifeq ($(TOOLING_REV),)
$(error missing .tooling-rev — this repo pins the shared tooling by commit sha)
endif
ifneq ($(TOOLING_REV),$(TOOLING_HAVE))
TOOLING_SYNC := $(shell bash scripts/tooling-sync.sh >&2 && echo ok)
ifneq ($(TOOLING_SYNC),ok)
$(error shared tooling could not be synced — see the [tooling] lines above)
endif
endif

# The include brings targets with it, and the first target in a makefile is the
# default goal. Name the goal explicitly so `make` with no arguments still
# prints help rather than cutting a worktree.
.DEFAULT_GOAL := help

include $(TOOLING)/mk/common.mk
include $(TOOLING)/mk/node.mk

# --- end shared tooling ------------------------------------------------------

# The enums the boards validate against, and the wire snapshots the types are
# checked against, are produced by the yeaboi repo's Python. They arrive here as
# a vendored snapshot pinned by sha in `.contracts-rev`; never edit anything
# under contracts/ in this repo — `make contracts-check` fails if you do.
CONTRACTS_REPO  := https://github.com/yeaboi-ai/yeaboi.ai.git
CONTRACTS_DIR   := .
CONTRACTS_PATHS := contracts/web

.PHONY: help gen-enums pack-design dev clean dist-check wheel-check

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# Everything the devkit plugin calls — lint, format, format-check, typecheck,
# test, test-fast, test-scoped, build — comes from mk/node.mk above and maps
# onto the npm scripts. Nothing is overridden here: an override of a target
# that already has a recipe makes `make` warn, and the warning is right.
#
# `npm run lint` is `npm run typecheck`. There is no ESLint in this tree and
# never was; with strict TypeScript on, `tsc --noEmit` is what actually rejects
# code, so that is what the target honestly runs. Adding a real linter is its
# own change. Prettier IS real — `format` and `format:check` do what they say.

gen-enums: ## Render src/types/enums.ts from the vendored enums contract
	$(NPM) run gen-enums

pack-design: ## Assemble the @yeaboi/design npm package into dist-design/
	$(NPM) run pack-design

# `make test` runs `typecheck` first, and `npm run typecheck` starts with
# `gen-enums --check` — so a stale enums.ts fails before anything reads it.

# To have the PYTHON side serve this tree's build instead of a published wheel,
# point a sibling yeaboi checkout at it — assets.py checks this before anything
# else:  YEABOI_WEB_STATIC=../yeaboi-frontend/yeaboi_web_assets/static
dev: ## Vite dev server on :5399 with HMR, proxying /api to a yeaboi dev board
	@echo "  dev/{retro,poker,deck,gate,export}.html on http://localhost:5399/"
	@echo "  boards need ?token=<token> from the yeaboi checkout's 'make dev-board';"
	@echo "  for poker, set YEABOI_DEV_API=http://127.0.0.1:5273 so /api proxies there."
	$(NPM) run dev

# Both read build output, so both depend on `build` rather than relying on where
# they land in a prerequisite list — that ordering holds only while make runs
# serially, and is exactly the kind of thing that breaks under `-j`.
dist-check: build ## Assert the built bundles are self-contained and shippable
	node scripts/check-dist.mjs

wheel-check: build ## Build the wheel, install it, and assert it carries the bundles
	uv run --no-project python scripts/check_wheel.py

clean: ## Remove build output
	rm -rf yeaboi_web_assets/static dist dist-design

# node.mk already makes this `lint format-check test build`. Adding prerequisites
# WITHOUT a recipe extends that list rather than replacing it — an override of a
# target that already has a recipe makes `make` warn, and the warning is right.
ship-gate: contracts-check tooling-check dist-check wheel-check
