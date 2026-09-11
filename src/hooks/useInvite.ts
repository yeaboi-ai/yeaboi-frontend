/**
 * Fetch the invite as soon as the board is joined, and put it on the clipboard
 * when the panel opens.
 *
 * ## Why it is fetched at all
 *
 * The join code is not in the boot payload and must not be. `GET /` is
 * unauthenticated, so everything in the JSON island is readable by anyone who
 * reaches the board — `retro/page.py` says so directly above `board_config`. A
 * code shipped there would be the gate handing out its own key. So it comes
 * from `GET /api/invite`, which is token-gated.
 *
 * ## Why it starts at join rather than at the press
 *
 * The board's Cloudflare tunnel comes up a few seconds after the board itself,
 * and until it does the server has no address worth handing out — it binds
 * loopback. Asked for the first time when the panel opens, that wait is spent
 * looking at a dialog that says "setting up the shared link", which you then
 * have to dismiss and reopen to find out whether anything changed. Asked from
 * the moment you are on the board, it is almost always ready before anyone
 * reaches for it — and while it is not, the Invite button itself says so.
 *
 * ## Why the copy is separate
 *
 * Opening the panel has one purpose: every path out of it ends with the link
 * somewhere else. Doing that on the way in removes the most common interaction
 * — but the clipboard is only writable inside the activation window a click
 * opens, and this hook's fetch no longer runs inside one. So the panel's opener
 * calls {@link UseInvite.copy} from its own handler. If a browser refuses
 * anyway the panel is unharmed: the values are on screen with their own copy
 * buttons, and the toast does not claim something untrue.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiUrl, type Session } from '../runtime/api';
import { copyText } from '../runtime/clipboard';
import type { InviteInfo } from '../types/board';

export interface UseInvite {
  /** The link and code, or `null` until the first fetch lands. */
  invite: InviteInfo | null;
  /** Toast text for the copy, or `null`. */
  notice: string | null;
  /** Clear the toast. Pass straight to `<Toast onDismiss>`. */
  dismiss: () => void;
  /** Still coming. The Invite button draws a loader in place of its icon and
   *  takes no press: there is nothing yet to put in the panel. */
  waiting: boolean;
  /** Put the link on the clipboard. Call it from the click that opens the
   *  panel, or the browser will refuse the write. */
  copy: () => void;
}

/** How often to re-ask while the tunnel is still coming up. */
const RETRY_MS = 3000;
/** How long to keep the button waiting before letting it open the panel
 *  anyway. Past this, a tunnel that is never coming ends in a panel that says
 *  so rather than in a button that spins for the rest of the session. */
const PATIENCE_MS = 20_000;

/** `enabled` false leaves the invite unasked for: a board opened to read a
 *  retro that already happened has nobody to invite to it. */
export function useInvite(session: Session, enabled = true): UseInvite {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const dismiss = useCallback(() => setNotice(null), []);
  const latest = useRef<InviteInfo | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Separate from `live`: one says the board is still on screen, the other
    // says there is nothing left to ask for.
    let done = false;
    let timer = 0;
    const patience = window.setTimeout(() => live && setSettled(true), PATIENCE_MS);

    const ask = async (): Promise<void> => {
      try {
        const response = await fetch(apiUrl(session, '/api/invite'));
        if (!response.ok) return;
        const data = (await response.json()) as InviteInfo;
        if (!live) return;

        latest.current = data;
        setInvite(data);

        // Nothing more to ask for: there is a link, or sharing is off and
        // there never will be one. A failed tunnel keeps polling, because
        // Retry Link in the terminal is what fixes it.
        //
        // Gated on `inviteUrl`, which is the value actually copied: gating on
        // `shareUrl` would call it ready the moment the two disagreed.
        if (data.shareState === 'off' || data.inviteUrl) done = true;
        if (done) setSettled(true);
      } catch {
        // The host closed the board, or the tunnel dropped. The board's own
        // reconnect notice covers the rest.
      }
    };

    const poll = async (): Promise<void> => {
      await ask();
      if (live && !done) timer = window.setTimeout(() => void poll(), RETRY_MS);
    };
    void poll();

    return () => {
      live = false;
      window.clearTimeout(timer);
      window.clearTimeout(patience);
    };
  }, [session, enabled]);

  const copy = useCallback(() => {
    const url = latest.current?.inviteUrl;
    // No link yet means the tunnel is still coming up, and the server
    // deliberately sent an empty `shareUrl` rather than the loopback address
    // the host is sitting on. Copying the code on its own would be a
    // half-invite — the reader gets a password and no door.
    if (!url) return;
    void copyText(url).then((copied) => {
      // Only claimed when it actually happened. "Copied" over an empty
      // clipboard is worse than saying nothing, because it stops the reader
      // reaching for the buttons that would have worked.
      setNotice(copied ? 'Invite link copied to your clipboard' : null);
    });
  }, []);

  return { invite, notice, dismiss, waiting: enabled && !settled, copy };
}
