import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const shortcuts = [
  { keys: ['←'], label: 'Previous period' },
  { keys: ['→'], label: 'Next period' },
  { keys: ['N'], label: 'New transaction' },
  { keys: ['H'], label: 'Hide or show balances' },
  { keys: ['?'], label: 'Show this list' },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="dashboard-shortcuts-title" className="w-full max-w-xs rounded-2xl border border-[var(--color-border)] bg-[var(--ref-surface-container-lowest)] p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="dashboard-shortcuts-title" className="font-headline text-base font-extrabold text-[var(--ref-on-surface)]">Keyboard shortcuts</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close keyboard shortcuts" className="grid h-8 w-8 place-items-center rounded-full text-[var(--ref-on-surface-variant)] hover:bg-[var(--ref-surface-container-high)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ref-primary)]"><X className="h-4 w-4" /></button>
        </div>
        <dl className="mt-4 space-y-2.5 text-sm">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.label} className="flex items-center justify-between gap-4">
              <dt className="text-[var(--ref-on-surface-variant)]">{shortcut.label}</dt>
              <dd className="flex gap-1">{shortcut.keys.map((key) => <kbd key={key} className="grid min-w-7 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--ref-surface-container-low)] px-1.5 py-0.5 font-mono text-xs font-semibold text-[var(--ref-on-surface)]">{key}</kbd>)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
