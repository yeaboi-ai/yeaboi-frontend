/** The liveness layer: four moments, the hooks that decide when they fire, and
 *  the motion of carrying something with a pointer. */

export { Ticker, type TickerProps } from './Ticker';
export { ARRIVAL_MS, useArrivals } from './useArrivals';
export {
  carriedTransform,
  edgeScroll,
  useCarry,
  EDGE,
  HOLD_MS,
  HOLD_SLOP,
  LAND_MS,
  SCROLL_RATE,
  SETTLE_MS,
  THRESHOLD,
  TILT_MAX,
  TILT_SPEED,
  type Carry,
  type CarryOptions,
  type CarryState,
  type Landing,
} from './useCarry';
