#!/usr/bin/env python3
"""Build the wheel, install it, and assert the bundles are actually in there.

The one failure this repo can produce that nothing downstream would catch in
time: a wheel that builds green, installs perfectly, and contains no bundles.
Every board and every export then renders nothing, for everyone who installed
from PyPI, and the only symptom is a blank page.

It is a live risk rather than a hypothetical. Hatchling loads ``.gitignore`` as
its exclude list, and this repo deliberately gitignores ``yeaboi_web_assets/static``
— the bundles are built in CI moments before the wheel is. The ``artifacts``
entry in ``pyproject.toml`` is the only thing putting them back, and deleting it
produces exactly the silent empty wheel described above.

So this checks the property the way the user meets it: install the built wheel
into a throwaway environment and resolve the files through
``importlib.resources``, which is how ``yeaboi``'s ``web/assets.py`` finds them.
Reading the zip would pass on a wheel whose layout ``importlib`` cannot see.

Stdlib only, and run through ``uv run --no-project`` — this repo's toolchain is
npm, and adding a Python dev environment to guard one property would be a poor
trade.

Usage::

    make wheel-check
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "yeaboi_web_assets" / "static"


def _run(*argv: str, cwd: Path | None = None) -> None:
    result = subprocess.run(argv, cwd=cwd, text=True, capture_output=True)
    if result.returncode != 0:
        sys.exit(f"✗ {' '.join(argv)} failed:\n{result.stdout}\n{result.stderr}")


def main() -> int:
    expected = sorted(p.name for p in STATIC.glob("*.js")) + sorted(p.name for p in STATIC.glob("*.css"))
    if not expected:
        sys.exit(f"✗ nothing built at {STATIC} — run: npm run build")

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "dist"
        _run("uv", "build", "--out-dir", str(out), str(ROOT))
        wheels = list(out.glob("*.whl"))
        if len(wheels) != 1:
            sys.exit(f"✗ expected one wheel, got {[w.name for w in wheels]}")

        venv = Path(tmp) / "venv"
        _run("uv", "venv", "--quiet", str(venv))
        python = venv / "bin" / "python"
        _run("uv", "pip", "install", "--quiet", "--python", str(python), str(wheels[0]))

        # Resolved the way the consumer resolves it, in a process that has never
        # seen this checkout — `cwd` is the temp dir so the source tree cannot
        # be found on sys.path and answer for the installed package.
        # An absent `static/` is the failure this exists to catch, so the probe
        # reports it as "no bundles" rather than raising — that way the message
        # below, which names the fix, is what the reader sees instead of a
        # traceback out of importlib.
        probe = (
            "import importlib.resources as r, json;"
            'd = r.files("yeaboi_web_assets") / "static";'
            "print(json.dumps(sorted(p.name for p in d.iterdir()) if d.is_dir() else []))"
        )
        result = subprocess.run([str(python), "-c", probe], cwd=tmp, text=True, capture_output=True)
        if result.returncode != 0:
            sys.exit(f"✗ the installed package could not resolve its own bundles:\n{result.stderr}")

        import json

        installed = json.loads(result.stdout)

    missing = sorted(set(expected) - set(installed))
    if missing:
        sys.exit(
            f"✗ the wheel is missing {len(missing)} of {len(expected)} bundles: {', '.join(missing)}\n"
            "  `artifacts` in pyproject.toml is what re-includes them past .gitignore."
        )
    print(f"✓ the wheel installs and carries all {len(expected)} bundles")
    return 0


if __name__ == "__main__":
    if shutil.which("uv") is None:
        sys.exit("✗ uv not found — needed to build and install the wheel")
    raise SystemExit(main())
