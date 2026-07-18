'use client';

/**
 * Minimal toast system (sonner-lite): a zustand store + a fixed-position
 * viewport rendered once in providers. `toast.success/error/info/loading`
 * from anywhere; loading toasts can be updated by id.
 */
import { create } from 'zustand';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastKind = 'success' | 'error' | 'info' | 'loading';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: ToastItem) => void;
  update: (id: string, patch: Partial<Omit<ToastItem, 'id'>>) => void;
  dismiss: (id: string) => void;
}

const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== t.id), t].slice(-5) })),
  update: (id, patch) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

let counter = 0;
const nextId = () => `toast-${++counter}`;

function push(kind: ToastKind, title: string, description?: string, opts?: { id?: string; duration?: number }) {
  const id = opts?.id ?? nextId();
  useToastStore.getState().push({ id, kind, title, description });
  const duration = opts?.duration ?? (kind === 'loading' ? 0 : kind === 'error' ? 6000 : 4000);
  if (duration > 0) {
    setTimeout(() => useToastStore.getState().dismiss(id), duration);
  }
  return id;
}

export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  info: (title: string, description?: string) => push('info', title, description),
  /** Returns an id; resolve with toast.resolve(id, ...) when done. */
  loading: (title: string, description?: string) => push('loading', title, description),
  /** Convert a loading toast into a final state and auto-dismiss. */
  resolve: (id: string, kind: Exclude<ToastKind, 'loading'>, title: string, description?: string) => {
    useToastStore.getState().update(id, { kind, title, description });
    setTimeout(() => useToastStore.getState().dismiss(id), kind === 'error' ? 6000 : 4000);
  },
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};

const icons: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  error: <AlertCircle className="h-4 w-4 text-red-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
  loading: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
};

/** Renders active toasts. Mount once (in providers). */
export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover p-3 pr-8 shadow-lg relative',
            )}
          >
            <span className="mt-0.5 shrink-0">{icons[t.kind]}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              ) : null}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
