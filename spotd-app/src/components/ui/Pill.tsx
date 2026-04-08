import { type ButtonHTMLAttributes, forwardRef } from 'react';
import styles from './Pill.module.css';

type Variant = 'default' | 'chip' | 'amenity' | 'day' | 'badge';

interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  active?: boolean;
  icon?: React.ReactNode;
}

export const Pill = forwardRef<HTMLButtonElement, PillProps>(
  ({ variant = 'default', active, icon, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          styles.pill,
          styles[variant],
          active && styles.active,
          className,
        ].filter(Boolean).join(' ')}
        {...props}
      >
        {icon && <span className={styles.icon}>{icon}</span>}
        {children}
      </button>
    );
  }
);

Pill.displayName = 'Pill';
