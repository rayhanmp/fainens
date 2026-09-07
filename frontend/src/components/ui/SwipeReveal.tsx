import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface SwipeRevealProps {
  children: ReactNode;
  actions: ReactNode;
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActivate: () => void;
  label: string;
}

const REVEAL_WIDTH = 176;
const OPEN_THRESHOLD = 48;

/** Optional touch shortcut. Every action must also remain available by tap. */
export function SwipeReveal({ children, actions, className, open, onOpenChange, onActivate, label }: SwipeRevealProps) {
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const draggedRef = useRef(false);
  const [dragOffset, setDragOffset] = useState<number | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' || event.button !== 0 || !window.matchMedia('(max-width: 767px)').matches) return;
    startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    draggedRef.current = false;
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!draggedRef.current && Math.abs(dy) > Math.abs(dx)) {
      startRef.current = null;
      setDragOffset(null);
      return;
    }
    if (Math.abs(dx) < 6 && !draggedRef.current) return;
    draggedRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = open ? -REVEAL_WIDTH : 0;
    setDragOffset(Math.max(-REVEAL_WIDTH, Math.min(0, base + dx)));
  };

  const finishGesture = (event: PointerEvent<HTMLElement>) => {
    const offset = dragOffset;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    startRef.current = null;
    setDragOffset(null);
    if (offset != null) onOpenChange(offset <= -OPEN_THRESHOLD);
  };

  const translate = dragOffset ?? (open ? -REVEAL_WIDTH : 0);

  return (
    <article className={cn('relative overflow-hidden', className)} aria-label={label}>
      <div className="absolute inset-y-0 right-0 flex w-44 items-stretch justify-end bg-[var(--ref-surface-container-high)] md:hidden">
        {actions}
      </div>
      <div
        className={cn('relative bg-[var(--ref-surface-container-lowest)] touch-pan-y', dragOffset == null && 'transition-transform duration-200 ease-out')}
        style={{ transform: `translateX(${translate}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={finishGesture}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          if (open) onOpenChange(false);
          else onActivate();
        }}
      >
        {children}
      </div>
    </article>
  );
}
