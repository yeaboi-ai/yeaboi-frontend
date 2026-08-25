"""The built front-end bundles for yeaboi's browser surfaces.

Data only. There is nothing to import and call: the package exists so that
``yeaboi``'s ``web/assets.py`` can find ``static/`` through
``importlib.resources``, wherever pip put it.

``static/`` holds one ``.js`` and one ``.css`` per Vite entry — deck, export,
gate, poker, retro, ship. Each is a self-contained classic script: no CDN, no
``eval``, no dynamic ``import()``, IIFE rather than ESM. Those are not style
rules. An exported report is opened over ``file://``, where a ``type="module"``
script does not execute at all, and a tunnel-served board runs under a CSP with
no external origins. ``yeaboi``'s ``tests/unit/test_web_assets.py`` asserts all
of it against whatever is actually installed.

Built and published from https://github.com/yeaboi-ai/yeaboi-frontend.
"""

from __future__ import annotations

__all__ = ["STATIC"]

#: Name of the directory inside this package that holds the bundles.
STATIC = "static"
