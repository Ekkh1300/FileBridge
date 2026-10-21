import React from 'react';
import { useStore } from '../lib/store.jsx';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';

const toneIcon = {
  ok: <CheckCircle2 size={16} className="text-good shrink-0" />,
  good: <CheckCircle2 size={16} className="text-good shrink-0" />,
  bad: <AlertTriangle size={16} className="text-risk shrink-0" />,
  info: <Info size={16} className="text-accent shrink-0" />,
};

export default function Toasts() {
  const { state, dispatch } = useStore();
  if (state.toasts.length === 0) return null;
  return (
    <div
      className="fixed z-50 bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 w-[min(92vw,26rem)] px-2"
      role="region"
      aria-label="Notifications"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {state.toasts.map((t) => (
        <div key={t.id} className="toast toast-in w-full flex items-start gap-2.5 px-4 py-3 text-sm shadow-lg">
          {toneIcon[t.tone] || toneIcon.info}
          <span className="leading-snug pr-1">{t.text}</span>
          <button
            className="ml-auto btn btn-ghost !min-h-0 !p-1 text-dim hover:text-ink"
            onClick={() => dispatch({ type: 'toast-remove', id: t.id })}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
