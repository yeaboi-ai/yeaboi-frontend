/**
 * Fetch the invite when the panel opens, and put it on the clipboard.
 *
 * ## Why it is fetched at all
 *
 * The join code is not in the boot payload and must not be. `GET /` is
 * unauthenticated, so everything in the JSON island is readable by anyone who
 * reaches the board — `retro/page.py` says so directly above `board_config`. A
 * code shipped there would be the gate handing out its own key. So it comes from
 * `GET /api/invite`, which is token-gated.
 *
 * ## Why it copies without being asked
 *
 * Opening the invite panel has one purpose. Every path out of it ends with the
 * link somewhere else — a chat window, a calendar invite — so doing that step
 * on the way in removes the most common interaction entirely.
 *
 * It works because opening the panel is a click: the write happens inside the
 * activation window that click opened. If a browser refuses anyway the panel is
 * unharmed — the values are on screen with their own copy buttons, and the toast
 * simply does not claim something untrue.
 *
 * ## Why it refetches on every open
 *
 * The board's Cloudflare tunnel comes up a few seconds after the board itself,
 * and until it does the server has no address worth handing out — it binds
 * loopback. A panel opened in that window would cache an answer that is about to
 * be replaced by the real one, so it asks again every time instead.
 *
 * ## Why the panel waits for it
 *
 * Which is why `waiting` exists: pressed in that window, the Invite button
 * turns into a loader and the panel holds off until there is a link to put in
 * it. A panel that opens onto "setting up the shared link" is a dialog you have
 * to dismiss and reopen to find out whether anything changed.
 */

import { useCallback, useEffect, useState } from 'react';

import { apiUrl, type Session } from '../runtime/api';
import { copyText } from '../runtime/clipboard';
import type { InviteInfo } from '../types/board';

export interface UseInvite {
  /** The link and code, or `null` until the fetch lands. */
  invite: InviteInfo | null;
  /** Toast text for the auto-copy, or `null`. */
  notice: string | null;
  /** Clear the toast. Pass straight to `<Toast onDismiss>`. */
  dismiss: () => void;
  /** Asked for, and nothing worth showing has come back yet. The button that
   *  asked draws a loader in place of its icon. */
  waiting: boolean;
  /** There is something to put on screen: a link, or a settled reason there
   *  will not be one. Also true once {@link PATIENCE_MS} has passed, so a slow
   *  tunnel ends in a panel that explains itself rather than in a button that
   *  spins forever. */
  ready: boolean;
}

/** How often to re-ask while the tunnel is still coming up. */
const RETRY_MS = 3000;
/** How long the button waits before it gives up and opens the panel anyway. */
const PATIENCE_MS = 9000;

export function useInvite(session: Session, open: boolean): UseInvite {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const dismiss = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    const patience = window.setTimeout(() => setReady(true), PATIENCE_MS);

    // Guards a fetch that resolves after the panel has been closed again, which
    // would otherwise raise a toast over a board with no panel on it.
    let live = true;
    // Separate from `live`: one says the panel is still on screen, the other
    // says there is nothing left to ask for. Reusing `live` for both would
    // swallow the copy toast on the very fetch that succeeded.
    let settled = false;
    let timer = 0;

    const ask = async (): Promise<void> => {
      try {
        const response = await fetch(apiUrl(session, '/api/invite'));
        if (!response.ok) return;
        const data = (await response.json()) as InviteInfo;
        if (!live) return;

        setInvite(data);

        // No link yet means the tunnel is still coming up, and the server
        // deliberately sent an empty `shareUrl` rather than the loopback address
        // the host is sitting on. Copying the code on its own would be a
        // half-invite — the reader gets a password and no door — so the panel
        // shows what it has and says nothing about the clipboard.
        //
        // Gated on `inviteUrl`, which is the value actually copied: gating on
        // `shareUrl` would put `undefined` on the clipboard the moment the two
        // disagreed.
        // Nothing more to ask for: there is a link, or sharing is off and
        // there never will be one. A failed tunnel keeps polling, because
        // Retry Link in the terminal is what fixes it.
        if (data.shareState === 'off') settled = true;
        // The panel is worth opening the moment there is a link, or once it is
        // clear there will never be one.
        if (settled) setReady(true);
        if (!data.inviteUrl) return;
        settled = true;
        setReady(true);

        const copied = await copyText(data.inviteUrl);
        if (!live) return;
        // Only claimed when it actually happened. "Copied" over an empty
        // clipboard is worse than saying nothing, because it stops the reader
        // reaching for the buttons that would have worked.
        setNotice(copied ? 'Invite link copied to your clipboard' : null);
      } catch {
        // The host closed the board, or the tunnel dropped. The panel still
        // shows the QR, and the board's own reconnect notice covers the rest.
      }
    };

    // The tunnel takes up to a minute to come up, and the panel is usually
    // opened while it still is. Asked again until there is a link rather than
    // once, or "setting up the shared link" is what it says until you close the
    // panel and open it again. Stops on the first success, and on close.
    const poll = async (): Promise<void> => {
      await ask();
      if (live && !settled) timer = window.setTimeout(() => void poll(), RETRY_MS);
    };
    void poll();

    return () => {
      live = false;
      window.clearTimeout(timer);
      window.clearTimeout(patience);
    };
  }, [open, session]);

  return { invite, notice, dismiss, waiting: open && !ready, ready: open && ready };
}
