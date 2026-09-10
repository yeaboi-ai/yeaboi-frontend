/**
 * The carry, with a board that is not a retro board.
 *
 * useCardDrag.test.tsx already drives the whole stack over columns and cards.
 * This one exists to hold the seam open: the hook is given a grid of cells and
 * a target shape it has never seen, and must carry something across it without
 * knowing what either is. If a retro assumption ever creeps back in, this is
 * the test that stops compiling.
 */

import { act, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCarry } from './useCarry';

/** Four cells in a 2×2, each 100px square. Nothing here is a column. */
interface Cell {
  col: number;
  row: number;
}

let renders = 0;

function Harness({ onDrop }: { onDrop: (id: string, cell: Cell) => void }) {
  renders += 1;
  const { carry, onHandlePointerDown, onBodyPointerDown } = useCarry<Cell, DOMRect>({
    itemSelector: '[data-widget]',
    survey: () => screen.getByTestId('grid').getBoundingClientRect(),
    hitTest: (box, x, y) => {
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
      return { col: Math.floor((x - box.left) / 100), row: Math.floor((y - box.top) / 100) };
    },
    sameTarget: (a, b) => a.col === b.col && a.row === b.row,
    onDrop,
  });

  return (
    <div>
      <div
        data-widget="w1"
        data-testid="body"
        onPointerDown={(e) => onBodyPointerDown('w1', e as unknown as PointerEvent)}
      >
        <button
          type="button"
          onPointerDown={(e) => onHandlePointerDown('w1', e as unknown as PointerEvent)}
        >
          handle
        </button>
      </div>
      <div data-testid="grid" />
      <output data-testid="at">
        {carry?.target ? `${carry.target.col},${carry.target.row}` : ''}
      </output>
      <output data-testid="held">{carry ? carry.itemId : ''}</output>
    </div>
  );
}

/** jsdom has no layout, so the geometry is stated outright. */
function installLayout(): void {
  screen.getByTestId('grid').getBoundingClientRect = () =>
    ({ left: 0, right: 200, top: 0, bottom: 200, width: 200, height: 200 }) as DOMRect;
  screen.getByTestId('body').getBoundingClientRect = () =>
    ({ left: 0, right: 60, top: 0, bottom: 40, width: 60, height: 40 }) as DOMRect;
}

/** Pointer moves are coalesced into a frame jsdom would otherwise defer. */
function runFramesInline(): void {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
}

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
}

function fire(target: EventTarget, event: Event): void {
  act(() => {
    target.dispatchEvent(event);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useCarry', () => {
  function setup() {
    const onDrop = vi.fn();
    runFramesInline();
    render(<Harness onDrop={onDrop} />);
    installLayout();
    renders = 0;
    return { onDrop, handle: screen.getByRole('button', { name: 'handle' }) };
  }

  it('carries a thing to a target of the caller’s own shape', () => {
    const { onDrop, handle } = setup();
    fire(handle, pointer('pointerdown', 10, 10));
    fire(document, pointer('pointermove', 150, 120));
    expect(screen.getByTestId('at').textContent).toBe('1,1');

    fire(document, pointer('pointerup', 150, 120));
    expect(onDrop).toHaveBeenCalledWith('w1', { col: 1, row: 1 });
  });

  it('reports no target off the board, and drops nothing there', () => {
    const { onDrop, handle } = setup();
    fire(handle, pointer('pointerdown', 10, 10));
    fire(document, pointer('pointermove', 400, 400));
    expect(screen.getByTestId('at').textContent).toBe('');
    fire(document, pointer('pointerup', 400, 400));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('re-renders once per slot, not once per pixel', () => {
    // Every pixel of movement is written straight to the carried element's
    // style; React hears about the slot alone, and `sameTarget` is what tells
    // it two hits mean the same one.
    const { handle } = setup();
    fire(handle, pointer('pointerdown', 10, 10));
    fire(document, pointer('pointermove', 20, 20));
    const afterFirst = renders;
    fire(document, pointer('pointermove', 30, 30));
    fire(document, pointer('pointermove', 40, 40));
    fire(document, pointer('pointermove', 50, 50)); // all still cell 0,0
    expect(renders).toBe(afterFirst);

    fire(document, pointer('pointermove', 150, 50)); // cell 1,0
    expect(renders).toBeGreaterThan(afterFirst);
    expect(screen.getByTestId('at').textContent).toBe('1,0');
  });

  it('leaves a press under the threshold alone', () => {
    const { onDrop, handle } = setup();
    fire(handle, pointer('pointerdown', 10, 10));
    fire(document, pointer('pointermove', 12, 11));
    fire(document, pointer('pointerup', 12, 11));
    expect(onDrop).not.toHaveBeenCalled();
    expect(screen.getByTestId('held').textContent).toBe('');
  });

  it('makes a finger hold before it carries', () => {
    // A body that grabbed the gesture immediately would be a page you can no
    // longer scroll. jsdom reports no pointerType, which is the touch path.
    vi.useFakeTimers();
    runFramesInline();
    render(<Harness onDrop={vi.fn()} />);
    installLayout();

    fire(screen.getByTestId('body'), pointer('pointerdown', 10, 10));
    fire(document, pointer('pointermove', 12, 12));
    expect(screen.getByTestId('held').textContent).toBe(''); // still a scroll

    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByTestId('held').textContent).toBe('w1');
  });

  it('abandons the hold if the finger strays first', () => {
    vi.useFakeTimers();
    runFramesInline();
    render(<Harness onDrop={vi.fn()} />);
    installLayout();

    fire(screen.getByTestId('body'), pointer('pointerdown', 10, 10));
    fire(document, pointer('pointermove', 60, 10)); // past the 8px slop
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByTestId('held').textContent).toBe('');
  });

  it('ignores a body press that landed on a control', () => {
    // The handle is a button inside the item, so the press bubbles to the body
    // handler too. A tap on it must stay a click — that is what opens whatever
    // menu the caller put there.
    vi.useFakeTimers();
    runFramesInline();
    render(<Harness onDrop={vi.fn()} />);
    installLayout();

    fire(screen.getByRole('button', { name: 'handle' }), pointer('pointerdown', 10, 10));
    // The handle's own press armed nothing yet; the body's saw a button and
    // bailed, so no hold is pending either.
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByTestId('held').textContent).toBe('');
  });

  it('cancels on Escape', () => {
    const { onDrop, handle } = setup();
    fire(handle, pointer('pointerdown', 10, 10));
    fire(document, pointer('pointermove', 150, 120));
    fire(document, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onDrop).not.toHaveBeenCalled();
    expect(screen.getByTestId('held').textContent).toBe('');
  });

  it('lets go of the document when its owner unmounts mid-carry', () => {
    runFramesInline();
    const { unmount } = render(<Harness onDrop={vi.fn()} />);
    installLayout();
    fire(screen.getByRole('button', { name: 'handle' }), pointer('pointerdown', 10, 10));
    fire(document, pointer('pointermove', 150, 120));

    const removed = vi.spyOn(document, 'removeEventListener');
    unmount();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(['pointermove', 'pointerup', 'pointercancel', 'keydown']),
    );
  });
});
