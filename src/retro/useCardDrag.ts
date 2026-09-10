/**
 * Dragging a card between columns, with a pointer instead of HTML5 drag-and-drop.
 *
 * The motion — the gesture, the swing, the landing — is {@link useCarry}. What
 * is left here is the board: which column the pointer is over, where in it the
 * card would land, and what to say about it.
 *
 * ## Why not `draggable="true"`
 *
 * The old board used the HTML5 drag API. `dragstart` and `drop` **do not fire
 * for touch input** in any mobile browser, so moving a card on a phone is not
 * merely awkward, it is impossible — and a retro board whose whole purpose is a
 * tunnel link people open on their phones cannot have a core interaction that
 * only works with a mouse.
 *
 * ## Why not @dnd-kit
 *
 * It is a React library and this bundle is `preact/compat`, so "it works" would
 * be an assumption to verify in a browser rather than a fact — and a drag that
 * fails only over the tunnel is exactly the class of bug the CSP guard exists
 * to prevent. And it is ~13 KB gzipped on a page inlined into every board load
 * over a phone connection, when choosing preact over React to save 170 KB was
 * the whole reason the runtime is what it is. The requirement here is one card
 * into one column at one index, not a general sortable tree.
 *
 * Keyboard users do not drag at all: the grip is a real button that opens a
 * "Move to…" menu (see CardView). Emulating a drag with arrow keys is a worse
 * interaction than simply naming the destination.
 */

import { useCallback, useMemo, useState, type MutableRefObject } from 'react';

import { carriedTransform, edgeScroll, useCarry, type CarryState } from '../motion/useCarry';
import type { RetroGrids } from '../types/enums';

export { carriedTransform };

export interface DropTarget {
  grid: RetroGrids;
  /** Insertion index within that column. */
  index: number;
}

export type DragState = Omit<CarryState<DropTarget>, 'itemId'> & { cardId: string };

export interface CardDragOptions {
  onMove(cardId: string, grid: RetroGrids, index: number): void;
  /** Names the columns, for the announcement. */
  gridLabel(grid: RetroGrids): string;
  enabled?: boolean;
}

export interface CardDrag {
  drag: DragState | null;
  /**
   * Attach to the carried card. Its transform is written here rather than
   * rendered, so following the pointer costs no React work.
   */
  previewRef: MutableRefObject<HTMLElement | null>;
  /** Attach to the grip element of the card with this id. */
  onGripPointerDown(cardId: string, event: PointerEvent): void;
  /** Attach to the card body. Mice pick up at once; fingers hold first. */
  onCardPointerDown(cardId: string, event: PointerEvent): void;
  /** Live-region text describing the drag. Render it in an `aria-live` node. */
  announcement: string;
}

/**
 * Everything the drag needs to know about the board, measured once.
 *
 * A hit test that ran `getBoundingClientRect` on every card would do it on the
 * frame that had just written the carried card's transform, forcing a
 * synchronous layout of the whole document each time. The card list is frozen
 * for the duration of a drag (see useFrozen), so nothing can move except by the
 * column scrolling, which is one number.
 */
interface Zone {
  grid: RetroGrids;
  el: HTMLElement;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Whether the column can scroll at all, so the edge nudge can be skipped. */
  scrollable: boolean;
  /** Its scroll offset when measured; the nudge below moves it from here. */
  scroll0: number;
  /** Each resting card's vertical midpoint, in viewport coordinates. */
  mids: number[];
}

function measure(draggedId: string): Zone[] {
  return [...document.querySelectorAll<HTMLElement>('[data-grid]')].map((el) => {
    const rect = el.getBoundingClientRect();
    const mids = [...el.querySelectorAll<HTMLElement>('[data-card-id]')]
      .filter((card) => card.dataset['cardId'] !== draggedId)
      .map((card) => {
        const box = card.getBoundingClientRect();
        return box.top + box.height / 2;
      });
    return {
      grid: el.dataset['grid'] as RetroGrids,
      el,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      scrollable: el.scrollHeight > el.clientHeight,
      scroll0: el.scrollTop,
      mids,
    };
  });
}

/** Where a card released at `y` would land in `zone`. */
function indexIn(zone: Zone, y: number): number {
  const shift = zone.el.scrollTop - zone.scroll0;
  let index = 0;
  while (index < zone.mids.length && y > (zone.mids[index] as number) - shift) index += 1;
  return index;
}

/**
 * Where the released card flies to.
 *
 * The indicator is already drawn exactly where the card is going, so it is the
 * target — no second guess at the landing position, and it is right whichever
 * column and index the drop resolved to. It sits half a gap outside the slot it
 * marks, though, so the slot is what to aim at.
 */
function slotUnderIndicator(): { left: number; top: number } | null {
  const line = document.querySelector<HTMLElement>('[data-drop-line]');
  const slot = line?.parentElement;
  if (!line || !slot) return null;
  const kind = line.dataset['dropLine'];
  const box = slot.getBoundingClientRect();
  const style = getComputedStyle(slot);
  if (kind === 'tail') return { left: box.left, top: box.bottom + (parseFloat(style.rowGap) || 0) };
  if (kind === 'empty') {
    return {
      left: box.left + parseFloat(style.paddingLeft),
      top: box.top + parseFloat(style.paddingTop),
    };
  }
  return { left: box.left, top: box.top };
}

export function useCardDrag({ onMove, gridLabel, enabled = true }: CardDragOptions): CardDrag {
  const [announcement, setAnnouncement] = useState('');

  const { carry, previewRef, onHandlePointerDown, onBodyPointerDown } = useCarry<
    DropTarget,
    Zone[]
  >({
    itemSelector: '[data-card-id]',
    survey: measure,
    hitTest: useCallback((zones: Zone[], x: number, y: number) => {
      const zone = zones.find((z) => x >= z.left && x <= z.right && y >= z.top && y <= z.bottom);
      if (!zone) return null;
      if (zone.scrollable) edgeScroll(zone.el, y, zone.top, zone.bottom);
      return { grid: zone.grid, index: indexIn(zone, y) };
    }, []),
    sameTarget: useCallback(
      (a: DropTarget, b: DropTarget) => a.grid === b.grid && a.index === b.index,
      [],
    ),
    landingAt: slotUnderIndicator,
    onPick: useCallback(
      () => setAnnouncement('Picked up. Drag to a column, or press Escape to cancel.'),
      [],
    ),
    onDrop: useCallback(
      (cardId: string, target: DropTarget) => {
        onMove(cardId, target.grid, target.index);
        // 1-based: "position 0" is not something anyone says out loud.
        setAnnouncement(`Moved to ${gridLabel(target.grid)}, position ${target.index + 1}.`);
      },
      [gridLabel, onMove],
    ),
    // Released over the toolbar, the composer, or the gap between columns.
    // Distinct from a cancel: nothing went wrong and nothing was undone, and
    // saying "cancelled" would suggest the move had been rejected.
    onMiss: useCallback(
      () => setAnnouncement('Dropped outside a column. The card did not move.'),
      [],
    ),
    onCancel: useCallback(() => setAnnouncement('Move cancelled.'), []),
    enabled,
  });

  const drag = useMemo<DragState | null>(
    () => (carry ? { ...carry, cardId: carry.itemId } : null),
    [carry],
  );

  return {
    drag,
    previewRef,
    onGripPointerDown: onHandlePointerDown,
    onCardPointerDown: onBodyPointerDown,
    announcement,
  };
}
