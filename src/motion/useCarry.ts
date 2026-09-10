/**
 * Carrying a thing with a pointer: the gesture, the swing and the landing.
 *
 * The motion only. What the pointer is *over* is the caller's: it surveys the
 * board once at pickup and answers, per frame, what lies under the pointer.
 * This hook never looks at what it is carrying, and never touches a class name
 * — appearance stays entirely in the caller's stylesheet.
 *
 * ## Where a carry starts
 *
 * Anywhere on the body with a mouse, and from a handle or a short hold with a
 * finger. The split is not a preference: a pointer drag needs the browser to
 * stop treating the gesture as a scroll, and on touch that decision can only be
 * made before the first move — so a body that grabbed the whole surface
 * immediately would be a list you can no longer scroll. A hold is the gesture
 * that says "this one", and the handle stays for anyone who would rather not
 * wait for it.
 *
 * Keyboard users do not drag at all. Give them a named destination instead.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

/** Pixels of movement before a press becomes a carry, so a tap still taps. */
export const THRESHOLD = 4;
/** How long a finger rests before it can carry, in ms. */
export const HOLD_MS = 300;
/** How far a finger may stray during that hold and still arm the carry, in px. */
export const HOLD_SLOP = 8;
/** Distance from a scroller's edge at which it starts auto-scrolling, in px. */
export const EDGE = 56;
/** Auto-scroll speed at the very edge, in px per frame. */
export const SCROLL_RATE = 12;
/** Degrees of lean at full tilt. */
export const TILT_MAX = 9;
/** Horizontal speed, in px per *frame*, that reaches it. */
export const TILT_SPEED = 40;
/** Quiet time after which a carried thing swings back upright, in ms. */
export const SETTLE_MS = 70;
/** How long the released thing takes to fly into the slot it was dropped on. */
export const LAND_MS = 220;

export interface CarryState<Target> {
  itemId: string;
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  /** Where inside the item it was grabbed, so it hangs where it was picked up. */
  grabX: number;
  grabY: number;
  /** The item's own width, so the carried copy is not a different object. */
  width: number;
  /** Lean, in degrees, from how fast it is being swung. */
  tilt: number;
  target: Target | null;
}

/** Viewport coordinates of the released item's resting place. */
export interface Landing {
  left: number;
  top: number;
}

export interface CarryOptions<Target, Survey> {
  /** Selects the element a press belongs to; its box is what the copy inherits. */
  itemSelector: string;
  /** Measure the board once, before anything moves. */
  survey(itemId: string): Survey;
  /** What lies under the pointer, on the frame that will paint it. */
  hitTest(survey: Survey, x: number, y: number): Target | null;
  /** Whether two hits are the same slot, so React only hears about changes. */
  sameTarget(a: Target, b: Target): boolean;
  /** Where a release on `target` should fly to. Null lands it in place. */
  landingAt?(target: Target): Landing | null;
  onPick?(itemId: string): void;
  onDrop(itemId: string, target: Target): void;
  /** Released somewhere that is not a slot. Nothing went wrong; nothing moved. */
  onMiss?(itemId: string): void;
  onCancel?(itemId: string): void;
  enabled?: boolean;
}

export interface Carry<Target> {
  carry: CarryState<Target> | null;
  /**
   * Attach to the carried copy. Its transform is written here rather than
   * rendered, so following the pointer costs no React work.
   */
  previewRef: MutableRefObject<HTMLElement | null>;
  /** Attach to a handle: a mouse picks up on the first movement. */
  onHandlePointerDown(itemId: string, event: PointerEvent): void;
  /** Attach to the body: mice pick up at once, fingers hold first. */
  onBodyPointerDown(itemId: string, event: PointerEvent): void;
}

/**
 * Where the carried thing hangs.
 *
 * The lean is the separate `rotate` property, not part of this transform, so
 * the stylesheet can transition it without also smoothing — and so visibly
 * lagging — the position. Individual transform properties compose after
 * `transform`, which puts the translation first and the pivot where the item
 * is being held.
 */
export function carriedTransform(carry: {
  x: number;
  y: number;
  grabX: number;
  grabY: number;
}): string {
  return `translate3d(${carry.x - carry.grabX}px, ${carry.y - carry.grabY}px, 0)`;
}

/**
 * Nudge a scroller the pointer is hovering near the top or bottom edge of.
 *
 * `top` and `bottom` are the scroller's viewport bounds, measured at pickup —
 * reading them here would force a layout on the frame that just wrote the
 * carried item's transform.
 */
export function edgeScroll(el: HTMLElement, y: number, top: number, bottom: number): void {
  const fromTop = y - top;
  const fromBottom = bottom - y;
  if (fromTop < EDGE) el.scrollTop -= SCROLL_RATE * (1 - fromTop / EDGE);
  else if (fromBottom < EDGE) el.scrollTop += SCROLL_RATE * (1 - fromBottom / EDGE);
}

export function useCarry<Target, Survey>(options: CarryOptions<Target, Survey>): Carry<Target> {
  const { itemSelector, enabled = true } = options;
  const [carry, setCarry] = useState<CarryState<Target> | null>(null);

  // The live carry lives in a ref as well as in state: the pointermove handler
  // needs the current target synchronously to decide whether anything changed,
  // and reading it from state would give it the value from the render that
  // installed the listener.
  const active = useRef<CarryState<Target> | null>(null);
  const opts = useRef(options);
  opts.current = options;

  // Set for the lifetime of one press. Held here so unmounting mid-carry can
  // run it — the listeners live on `document`, so without this a board torn
  // down with something in the air keeps four handlers alive against a dead
  // component.
  const teardownRef = useRef<(() => void) | null>(null);

  const previewRef = useRef<HTMLElement | null>(null);

  /**
   * Fly the released item into the slot it was dropped on. Resolves when it has
   * arrived, so the caller knows when to stop rendering it.
   */
  const land = useCallback((target: Target): Promise<void> => {
    const el = previewRef.current;
    const to = opts.current.landingAt?.(target);
    if (!el || !to || typeof el.animate !== 'function') return Promise.resolve();

    // The layer is the viewport and the item is pinned to its top-left corner,
    // so the translation *is* the position. The lift comes from whatever the
    // caller's stylesheet put on the carried copy.
    const lift = getComputedStyle(el).scale;
    const animation = el.animate(
      [
        {
          transform: el.style.transform,
          rotate: el.style.rotate || '0deg',
          scale: lift && lift !== 'none' ? lift : '1',
        },
        { transform: `translate3d(${to.left}px, ${to.top}px, 0)`, rotate: '0deg', scale: '1' },
      ],
      { duration: LAND_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    );
    return animation.finished.then(
      () => undefined,
      () => undefined,
    );
  }, []);

  const finish = useCallback(
    (commit: boolean) => {
      const current = active.current;
      active.current = null;
      if (!current) {
        setCarry(null);
        return;
      }
      if (commit && current.target !== null) {
        const target = current.target;
        opts.current.onDrop(current.itemId, target);
        // Held one flight longer: this is what keeps the slot open underneath
        // until the item has arrived in it.
        void land(target).then(() => setCarry(null));
        return;
      }
      if (commit) opts.current.onMiss?.(current.itemId);
      else opts.current.onCancel?.(current.itemId);
      setCarry(null);
    },
    [land],
  );

  // Cleared on every move and re-armed, so it only fires once the pointer has
  // actually stopped. That gap is the swing back to upright.
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Move the carried copy, without going through React. */
  const place = useCallback((x: number, y: number, tilt: number) => {
    const el = previewRef.current;
    const held = active.current;
    if (!el || !held) return;
    el.style.transform = carriedTransform({ ...held, x, y });
    el.style.rotate = `${tilt.toFixed(2)}deg`;
  }, []);

  /**
   * One press, from either a handle or the body.
   *
   * `hold` is the touch path: the carry arms on a timer instead of on movement,
   * and until it does every move is left alone so the page still scrolls.
   */
  const begin = useCallback(
    (itemId: string, event: PointerEvent, hold: boolean) => {
      // Secondary buttons open context menus; hijacking them would make
      // right-click-to-inspect start a carry instead.
      if (!enabled || (event.button !== undefined && event.button !== 0)) return;

      const from = event.currentTarget;
      const item = from instanceof Element ? from.closest<HTMLElement>(itemSelector) : null;
      const rect = item?.getBoundingClientRect();
      const grabX = rect ? event.clientX - rect.left : 0;
      const grabY = rect ? event.clientY - rect.top : 0;
      const width = rect?.width ?? 0;

      const originX = event.clientX;
      const originY = event.clientY;
      let started = false;
      let lastX = originX;
      let armTimer: ReturnType<typeof setTimeout> | undefined;

      // Not `preventDefault` on the press: cancelling pointerdown cancels the
      // compatibility mouse events with it, and the click that never fires is
      // the one that opens the thing. The gesture is claimed on the first move
      // that crosses the threshold instead, and the selection it would
      // otherwise paint is stopped by `user-select` at the same moment.

      const pick = (e: PointerEvent): void => {
        started = true;
        // Capture only once the carry is real. Capturing on pointerdown would
        // swallow the click that a plain tap on a handle should produce.
        try {
          if (from instanceof Element) from.setPointerCapture(e.pointerId);
        } catch {
          // No pointer capture (jsdom, or the pointer already ended). The
          // document-level listeners below carry the gesture either way.
        }
        // A drag across a page of text otherwise paints half of it blue.
        document.body.style.userSelect = 'none';
        survey = opts.current.survey(itemId);
        opts.current.onPick?.(itemId);
      };

      let pendingX = originX;
      let pendingY = originY;
      let queued = false;
      let frame = 0;
      let survey: Survey | undefined;

      /**
       * One update, on the frame that will paint it.
       *
       * Pointer events arrive faster than the screen refreshes, and a mouse
       * reporting at 1000 Hz would otherwise run the hit test and a React
       * render sixteen times per painted frame.
       */
      const flush = (): void => {
        const x = pendingX;
        const y = pendingY;

        const speed = x - lastX;
        lastX = x;
        const tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, (speed / TILT_SPEED) * TILT_MAX));
        place(x, y, tilt);

        const target = survey === undefined ? null : opts.current.hitTest(survey, x, y);

        const held = active.current;
        const next: CarryState<Target> = { itemId, x, y, grabX, grabY, width, tilt, target };
        active.current = next;
        // React only hears about the drop target. The carried copy's position
        // is written straight to its own style above, because re-rendering the
        // whole board to move one thing is what makes this stutter.
        if (!held || changed(held.target, target, opts.current.sameTarget)) setCarry(next);

        clearTimeout(settleRef.current);
        settleRef.current = setTimeout(() => {
          if (!active.current) return;
          active.current = { ...active.current, tilt: 0 };
          place(active.current.x, active.current.y, 0);
        }, SETTLE_MS);
      };

      const move = (e: PointerEvent): void => {
        if (e.pointerId !== event.pointerId) return;
        if (!started) {
          if (hold) {
            // Strayed before the hold elapsed: this was a scroll.
            if (Math.hypot(e.clientX - originX, e.clientY - originY) > HOLD_SLOP) teardown();
            return;
          }
          if (Math.hypot(e.clientX - originX, e.clientY - originY) < THRESHOLD) return;
          pick(e);
        }
        // Armed: the gesture is ours, and the browser must not also scroll with it.
        e.preventDefault();
        pendingX = e.clientX;
        pendingY = e.clientY;
        if (queued) return;
        queued = true;
        frame = requestAnimationFrame(() => {
          queued = false;
          flush();
        });
      };

      const up = (e: PointerEvent): void => {
        if (e.pointerId !== event.pointerId) return;
        teardown();
        // A press that never crossed the threshold is a click, not a carry —
        // let it through untouched.
        if (started) finish(true);
      };

      const cancel = (e: PointerEvent): void => {
        if (e.pointerId !== event.pointerId) return;
        teardown();
        if (started) finish(false);
      };

      const key = (e: KeyboardEvent): void => {
        if (e.key !== 'Escape') return;
        teardown();
        finish(false);
      };

      function teardown(): void {
        document.body.style.userSelect = '';
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        queued = false;
        clearTimeout(armTimer);
        clearTimeout(settleRef.current);
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', cancel);
        document.removeEventListener('keydown', key);
        teardownRef.current = null;
      }

      if (hold) {
        armTimer = setTimeout(() => {
          if (started) return;
          pick(event);
          const next: CarryState<Target> = {
            itemId,
            x: originX,
            y: originY,
            grabX,
            grabY,
            width,
            tilt: 0,
            target: null,
          };
          active.current = next;
          setCarry(next);
        }, HOLD_MS);
      }

      // `passive: false` on the move listener, or `preventDefault` above is
      // ignored on touch and the page scrolls out from under the item.
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', cancel);
      document.addEventListener('keydown', key);
      teardownRef.current = teardown;
    },
    [enabled, finish, itemSelector, place],
  );

  const onHandlePointerDown = useCallback(
    (itemId: string, event: PointerEvent) => begin(itemId, event, false),
    [begin],
  );

  const onBodyPointerDown = useCallback(
    (itemId: string, event: PointerEvent) => {
      // A press on a control inside the item is that control's, not a grab.
      const from = event.target;
      if (from instanceof Element && from.closest('button, a, input, textarea, select')) return;
      begin(itemId, event, event.pointerType !== 'mouse');
    },
    [begin],
  );

  useEffect(
    () => () => {
      teardownRef.current?.();
      clearTimeout(settleRef.current);
      active.current = null;
    },
    [],
  );

  return { carry, previewRef, onHandlePointerDown, onBodyPointerDown };
}

function changed<Target>(
  before: Target | null,
  after: Target | null,
  same: (a: Target, b: Target) => boolean,
): boolean {
  if (before === null || after === null) return before !== after;
  return !same(before, after);
}
