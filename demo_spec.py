"""What this repo's README GIF shows: a retro board, live, in a browser.

Recorded against the **real Python board serving committed bundles** — the
board `make dev-board` puts on :5173 in a yeaboi checkout — not the Vite dev
shell on :5399. The dev shell renders `dev/retro.html`, whose JSON island is a
deliberately shortened stand-in for what `retro/page.py` actually emits, and
Vite injects its HMR client on top. What ships is what should be filmed.

Retro rather than poker: `dev_poker.py` re-announces its crew from a daemon
thread every two seconds and is genuinely live, so state moves under the
recorder. The retro board is static until touched, which makes it repeatable.
"""

_BOARD = "http://127.0.0.1:5173/?token=dev-token&admin=dev-admin"

SPEC = {
    "kind": "page",
    "gif": "demo-frontend.gif",
    "url": _BOARD,
    "width": 1440,
    "height": 900,
    "fps": 20,
    # The board is seeded in the yeaboi repo, so that is where the server runs.
    "serve": ["make", "dev-board"],
    "serve_cwd": "$YEABOI_REPO",
    "serve_ready": _BOARD,
    "steps": [
        ("goto", _BOARD),
        # The board gates on a join, which is the honest way in: the columns
        # stay empty until someone is at the table.
        ("await", 'input[placeholder="Your name"]', 20),
        ("pause", 1.0),
        ("type", 'input[placeholder="Your name"]', "Ada", 12),
        ("pause", 0.5),
        ("click", 'button:has-text("🦊")'),
        ("pause", 0.6),
        ("click", 'button:has-text("Join")'),
        # Ten seeded cards land across all four grids.
        ("await", "#col-went_well", 20),
        ("pause", 2.8),
        # Add one live, so the GIF shows a board being worked rather than a
        # static screenshot that happens to move. The compose buttons live
        # outside the #col-* lists, so they are addressed by column order:
        # went_well, didnt_go_well, action_items, demos.
        ("click", 'button:has-text("Add a card") >> nth=2'),
        ("pause", 0.6),
        ("type", "textarea", "Book the retro before the sprint ends", 20),
        ("pause", 0.8),
        ("press", "Meta+Enter"),
        ("pause", 3.0),
    ],
    "verify": {
        "duration_s": (6.0, 45.0),
    },
}
