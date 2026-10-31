import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';

type ToastTone = 'success' | 'error';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<((tone: ToastTone, message: string) => void) | null>(null);
const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-2), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg bg-ink p-4 text-sm text-white shadow-card"
          >
            {toast.tone === 'success' ? (
              <CheckCircle2 className="mt-px size-4 shrink-0 text-success-50" aria-hidden />
            ) : (
              <CircleAlert className="mt-px size-4 shrink-0 text-danger-50" aria-hidden />
            )}
            <p className="flex-1">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="-m-1 rounded-sm p-1 text-white/70 hover:text-white"
              aria-label="Đóng thông báo"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return useMemo(
    () => ({
      success: (message: string) => show('success', message),
      error: (message: string) => show('error', message),
    }),
    [show],
  );
}
