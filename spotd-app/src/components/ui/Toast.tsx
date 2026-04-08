import { useEffect, useState } from 'react';
import styles from './Toast.module.css';

interface ToastMessage {
  id: string;
  text: string;
  type?: 'info' | 'success' | 'error';
}

let addToastFn: ((msg: Omit<ToastMessage, 'id'>) => void) | null = null;

/** Call from anywhere: showToast({ text: '...', type: 'success' }) */
export function showToast(msg: Omit<ToastMessage, 'id'>) {
  addToastFn?.(msg);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    addToastFn = (msg) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { ...msg, id }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    };
    return () => { addToastFn = null; };
  }, []);

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <div key={t.id} className={[styles.toast, styles[t.type || 'info']].join(' ')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
