/**
 * A ring with a gap in it, turning.
 *
 * Drawn on the same grid and stroke as {@link Icon} so it can stand in a
 * button where an icon was without the label beside it shifting.
 */

import { cx } from '../../runtime/cx';
import styles from './primitives.module.css';

export interface SpinnerProps {
  size?: number;
  /** For a control that has no text beside it. */
  label?: string;
  className?: string;
}

export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <svg
      className={cx(styles['spinner'], className)}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={16 / size}
      strokeLinecap="round"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      focusable="false"
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" />
    </svg>
  );
}
