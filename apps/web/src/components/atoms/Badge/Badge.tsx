import type { ReactNode } from 'react';
import { classNames } from '../../../lib/class-names.ts';
import styles from './Badge.module.scss';

type BadgeProps = { children: ReactNode; tone?: 'neutral' | 'accent' };

/** A short label such as a format ("3D", "IMAX"). */
export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={classNames(styles.badge, styles[tone])}>{children}</span>;
}
