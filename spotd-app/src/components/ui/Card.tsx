import { type HTMLAttributes, forwardRef } from 'react';
import styles from './Card.module.css';

type Variant = 'default' | 'hero' | 'compact' | 'flat';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  pressable?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', pressable = false, className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={[
          styles.card,
          styles[variant],
          pressable && styles.pressable,
          className,
        ].filter(Boolean).join(' ')}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';
