#!/usr/bin/env bash
# scripts/provision.sh — what a fresh worktree of THIS repo needs. wt.sh runs it
# from the new worktree's root. Every yeaboi repo has one (or deliberately does
# not): it is the seam where a shared script stops and a toolchain begins.
#
# One toolchain here, and it is npm. The wheel this repo publishes is built by
# CI from the same `npm run build`, so there is no Python environment to make.

set -euo pipefail

npm ci --silent
echo "[provision] node_modules ready"
