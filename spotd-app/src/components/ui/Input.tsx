import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react';
import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, className, ...props }, ref) => {
    return (
      <div className={styles.group}>
        {label && <label className={styles.label}>{label}</label>}
        <input
          ref={ref}
          className={[styles.field, className].filter(Boolean).join(' ')}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = 'Input';

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, className, ...props }, ref) => {
    return (
      <div className={styles.group}>
        {label && <label className={styles.label}>{label}</label>}
        <textarea
          ref={ref}
          className={[styles.field, styles.textarea, className].filter(Boolean).join(' ')}
          {...props}
        />
      </div>
    );
  }
);

TextArea.displayName = 'TextArea';

interface SearchProps extends InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void;
}

export const SearchBox = forwardRef<HTMLInputElement, SearchProps>(
  ({ onClear, className, value, ...props }, ref) => {
    return (
      <div className={styles.searchWrap}>
        <input
          ref={ref}
          type="search"
          className={[styles.search, className].filter(Boolean).join(' ')}
          value={value}
          {...props}
        />
        {value && onClear && (
          <button className={styles.clearBtn} onClick={onClear} aria-label="Clear">
            &times;
          </button>
        )}
      </div>
    );
  }
);

SearchBox.displayName = 'SearchBox';
