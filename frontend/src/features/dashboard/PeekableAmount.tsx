import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useBalanceVisibility } from '../../hooks/useBalanceVisibility';
import { formatCurrency } from '../../lib/utils';

/**
 * An amount that, while balances are hidden, reveals itself for as long as it is pressed.
 * A press that peeks does not also follow the link the amount sits in.
 */
export function PeekableAmount({ cents, className }: { cents: number; className?: string }) {
  const { balancesHidden, formatAmount } = useBalanceVisibility();
  const [peeking, setPeeking] = useState(false);
  const pressedRef = useRef(false);

  if (!balancesHidden) return <span className={className}>{formatAmount(cents)}</span>;

  const start = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pressedRef.current = true;
    setPeeking(true);
  };
  const stop = () => setPeeking(false);
  const swallowClick = (event: MouseEvent) => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <span
      className={`dashboard-peek ${className ?? ''}`}
      data-peeking={peeking}
      title="Press and hold to reveal"
      aria-label={peeking ? undefined : 'Hidden amount. Press and hold to reveal.'}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      onClickCapture={swallowClick}
    >
      {peeking ? formatCurrency(cents) : formatAmount(cents)}
    </span>
  );
}
