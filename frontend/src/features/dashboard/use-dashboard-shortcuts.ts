import { useEffect } from 'react';
import type { PeriodStep } from './navigation';

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Dashboard keys: ← / → step through periods, H hides or shows balances, ? opens the cheat sheet.
 * N (new transaction) is already handled app-wide by the shell.
 */
export function useDashboardShortcuts({ enabled, onStep, onToggleBalances, onShowHelp }: {
  enabled: boolean;
  onStep: (step: PeriodStep) => void;
  onToggleBalances: () => void;
  onShowHelp: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Panels, sliders and menus that use the arrow keys call preventDefault first.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        onStep(event.key === 'ArrowLeft' ? 'older' : 'newer');
      } else if (event.key === 'h' || event.key === 'H') {
        event.preventDefault();
        onToggleBalances();
      } else if (event.key === '?') {
        event.preventDefault();
        onShowHelp();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onShowHelp, onStep, onToggleBalances]);
}
