/**
 * Fetching the invite, and the copy on open.
 *
 * Three properties are worth pinning. The fetch starts at join rather than at
 * the press, because the tunnel takes a few seconds to come up and that wait
 * belongs to the button rather than to a dialog you have to dismiss and reopen.
 * It keeps asking until there is a link, because the host can start a tunnel
 * mid-session. And the toast must only claim a copy that actually happened — a
 * browser is entitled to refuse, and "copied" over an empty clipboard stops the
 * reader reaching for the buttons that would have worked.
 *
 * A board whose tunnel has not come up yet answers with an empty `shareUrl` —
 * deliberately, rather than the loopback address the host is looking at. There
 * is nothing to copy in that window: a code with no link is a password and no
 * door.
 *
 * What lands on the clipboard is one URL, `inviteUrl`, composed server-side by
 * `sharing.access.invite_url`. It used to be the link and the sentence "Access
 * code: …" on two lines, which any paste target that flattens a newline turned
 * into a single 404ing address.
 */

import { act, renderHook, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyText } from '../runtime/clipboard';
import type { Session } from '../runtime/api';
import { useInvite } from './useInvite';

vi.mock('../runtime/clipboard', () => ({ copyText: vi.fn() }));
const mockCopy = vi.mocked(copyText);

const SESSION: Session = { token: 'tok', admin: '', pid: 'p1' };
const INVITE = {
  shareUrl: 'https://x.trycloudflare.com/',
  joinCode: 'K3P9-2QXA',
  inviteUrl: 'https://x.trycloudflare.com/#code=K3P9-2QXA',
};
/** The board before its tunnel is up: a code, and nowhere to use it. */
const NOT_READY = { shareUrl: '', joinCode: 'K3P9-2QXA', inviteUrl: '' };

function answerWith(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mockCopy.mockReset();
  mockCopy.mockResolvedValue(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useInvite', () => {
  it('asks as soon as the board is joined, without waiting for a press', async () => {
    const fetchMock = answerWith(INVITE);
    renderHook(() => useInvite(SESSION));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('sends the token — the endpoint is gated', async () => {
    const fetchMock = answerWith(INVITE);
    renderHook(() => useInvite(SESSION));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('token=tok');
  });

  it('waits until there is a link, and then stops', async () => {
    // What the Invite button draws its loader from.
    answerWith(INVITE);
    const { result } = renderHook(() => useInvite(SESSION));
    expect(result.current.waiting).toBe(true);
    await waitFor(() => expect(result.current.waiting).toBe(false));
  });

  it('keeps waiting while the tunnel is still coming up', async () => {
    answerWith(NOT_READY);
    const { result } = renderHook(() => useInvite(SESSION));

    await waitFor(() => expect(result.current.invite).toEqual(NOT_READY));
    expect(result.current.waiting).toBe(true);
  });

  it('keeps asking, so a tunnel started mid-session is picked up', async () => {
    vi.useFakeTimers();
    const fetchMock = answerWith(NOT_READY);
    renderHook(() => useInvite(SESSION));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    vi.useRealTimers();
  });

  it('stops waiting when sharing is off, since no link is coming', async () => {
    answerWith({ ...NOT_READY, shareState: 'off' });
    const { result } = renderHook(() => useInvite(SESSION));
    await waitFor(() => expect(result.current.waiting).toBe(false));
  });

  it('copies one self-contained link, and says so', async () => {
    answerWith(INVITE);
    const { result } = renderHook(() => useInvite(SESSION));
    await waitFor(() => expect(result.current.invite).toEqual(INVITE));

    act(() => result.current.copy());
    // Exactly the server's string, and exactly one line: nothing here composes
    // a URL, and nothing here adds a second thing that could be glued onto it.
    expect(mockCopy).toHaveBeenCalledWith(INVITE.inviteUrl);
    expect(mockCopy.mock.calls[0]?.[0]).not.toMatch(/\s/);
    await waitFor(() => expect(result.current.notice).toBe('Invite link copied to your clipboard'));
  });

  it('copies nothing when the link is not ready yet', async () => {
    answerWith(NOT_READY);
    const { result } = renderHook(() => useInvite(SESSION));
    await waitFor(() => expect(result.current.invite).toEqual(NOT_READY));

    act(() => result.current.copy());
    expect(mockCopy).not.toHaveBeenCalled();
    expect(result.current.notice).toBeNull();
  });

  it('copies nothing when the link is there but the invite is not', async () => {
    // Guards the gate moving back onto `shareUrl`: that would put `undefined`
    // on the clipboard the moment the two fields disagreed.
    answerWith({ shareUrl: 'https://x.trycloudflare.com/', joinCode: 'K3P9-2QXA', inviteUrl: '' });
    const { result } = renderHook(() => useInvite(SESSION));
    await waitFor(() => expect(result.current.invite).not.toBeNull());

    act(() => result.current.copy());
    expect(mockCopy).not.toHaveBeenCalled();
    expect(result.current.notice).toBeNull();
  });

  it('stays silent when the browser refused the copy', async () => {
    mockCopy.mockResolvedValue(false);
    answerWith(INVITE);
    const { result } = renderHook(() => useInvite(SESSION));
    await waitFor(() => expect(result.current.invite).toEqual(INVITE));

    act(() => result.current.copy());
    await waitFor(() => expect(mockCopy).toHaveBeenCalled());
    expect(result.current.notice).toBeNull();
  });

  it('survives the host closing the board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('connection refused'))),
    );
    const { result } = renderHook(() => useInvite(SESSION));

    await act(async () => void (await Promise.resolve()));
    expect(result.current.invite).toBeNull();
    expect(result.current.notice).toBeNull();
  });

  it('does not raise a toast over a board that has already gone', async () => {
    // The fetch resolving after unmount would otherwise set state on a dead
    // component.
    answerWith(INVITE);
    const { result, unmount } = renderHook(() => useInvite(SESSION));
    unmount();

    await act(async () => void (await Promise.resolve()));
    expect(result.current.notice).toBeNull();
  });

  it('clears its toast on dismiss', async () => {
    answerWith(INVITE);
    const { result } = renderHook(() => useInvite(SESSION));
    await waitFor(() => expect(result.current.invite).toEqual(INVITE));

    act(() => result.current.copy());
    await waitFor(() => expect(result.current.notice).toBeTruthy());
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });
});
