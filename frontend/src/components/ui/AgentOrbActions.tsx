import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, CalendarClock, ChartNoAxesCombined, ImagePlus, ShoppingBag, Wallet, X } from 'lucide-react';
import { AgentOrb, type AgentOrbState } from './AgentOrb';

const shortcuts = [
  { title: 'Understand my spending', detail: 'Find the biggest expenses and patterns', icon: ChartNoAxesCombined, prompt: 'What were my top expenses recently, and what spending patterns stand out?' },
  { title: 'Check my budget', detail: 'See how this period is tracking', icon: Wallet, prompt: 'How is my budget tracking this period, and where should I adjust?' },
  { title: 'Look ahead at bills', detail: 'Review upcoming bills and obligations', icon: CalendarClock, prompt: 'What bills and obligations are coming up, and how much should I set aside?' },
  { title: 'Think through a purchase', detail: 'Work out what fits before buying', icon: ShoppingBag, prompt: 'Help me decide whether a purchase fits my budget. Ask me what I want to buy and how much it costs.' },
];

export function AgentOrbActions({ state = 'idle', status, className, onPrompt, onUpload, disabled = false }: {
  state?: AgentOrbState;
  status?: string;
  className?: string;
  onPrompt: (prompt: string) => void;
  onUpload?: () => void;
  disabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const label = status ?? (state === 'thinking' ? 'Working on your request' : state === 'error' ? 'Last request needs attention' : 'Ready when you are');

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const choose = (action: () => void) => {
    dialogRef.current?.close();
    action();
  };

  return <>
    <button
      type="button"
      className="agent-orb-trigger"
      aria-label={`Open Fainens shortcuts. ${label}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={dialogId}
      title={`Fainens · ${label} · Click for shortcuts`}
      onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'mouse') return;
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty('--orb-tilt-x', `${((event.clientY - bounds.top) / bounds.height - .5) * -18}deg`);
        event.currentTarget.style.setProperty('--orb-tilt-y', `${((event.clientX - bounds.left) / bounds.width - .5) * 18}deg`);
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.removeProperty('--orb-tilt-x');
        event.currentTarget.style.removeProperty('--orb-tilt-y');
      }}
    >
      <AgentOrb state={open && state === 'idle' ? 'ready' : state} className={className} />
      <span aria-hidden="true" className="agent-orb-trigger-spark">+</span>
    </button>
    {createPortal(
      <dialog ref={dialogRef} id={dialogId} aria-labelledby={titleId} className="agent-orb-dialog" onClose={() => setOpen(false)} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialogRef.current?.close();
      }}>
        <div className="relative px-6 pb-5 pt-8 text-center">
          <button type="button" autoFocus onClick={() => dialogRef.current?.close()} aria-label="Close Fainens shortcuts" className="agent-orb-dialog-close"><X className="h-4 w-4" /></button>
          <AgentOrb state={state} className="agent-orb-large" />
          <p className="mt-4 text-[10px] font-bold uppercase tracking-[.2em] text-[var(--ref-primary)]">Your finance companion</p>
          <h2 id={titleId} className="mt-1 text-xl font-semibold tracking-tight">A little clarity, one question away.</h2>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]" role="status">{label}</p>
        </div>
        <div className="space-y-1 px-3 pb-3">
          {shortcuts.map(({ title, detail, icon: Icon, prompt }) => <button key={title} type="button" disabled={disabled} className="agent-orb-action" onClick={() => choose(() => onPrompt(prompt))}>
            <span className="agent-orb-action-icon"><Icon className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">{detail}</span></span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--color-muted)]" />
          </button>)}
          {onUpload && <button type="button" disabled={disabled} className="agent-orb-action border-t border-[var(--color-border)]" onClick={() => choose(onUpload)}>
            <span className="agent-orb-action-icon"><ImagePlus className="h-[18px] w-[18px]" /></span>
            <span className="flex-1"><span className="block text-sm font-semibold">Bring a receipt</span><span className="mt-0.5 block text-xs text-[var(--color-text-secondary)]">Attach a photo to your next message</span></span>
            <ArrowUpRight className="h-4 w-4 text-[var(--color-muted)]" />
          </button>}
        </div>
        <p className="border-t border-[var(--color-border)] px-5 py-3 text-center text-[11px] text-[var(--color-muted)]">{disabled ? 'Shortcuts will be ready when the current request finishes.' : 'Choose a starting point. Make it yours before sending.'}</p>
      </dialog>, document.body,
    )}
  </>;
}
