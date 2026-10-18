import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type AgentOrbState = 'idle' | 'ready' | 'thinking' | 'error';

/**
 * Visual identity only; the trigger or adjacent text supplies its accessible label.
 * A glass sphere: drifting aurora light inside, a specular highlight and rim light on top,
 * and a comet-tail ring that appears only while the agent is working.
 */
export function AgentOrb({ active = false, state, className, badge }: { active?: boolean; state?: AgentOrbState; className?: string; badge?: ReactNode }) {
  return (
    <span aria-hidden="true" data-state={state ?? (active ? 'thinking' : 'idle')} className={cn('agent-orb', className)}>
      <span className="agent-orb-halo" />
      <span className="agent-orb-orbit" />
      <span className="agent-orb-shell">
        <span className="agent-orb-aurora" />
        <span className="agent-orb-flow" />
        <span className="agent-orb-gloss" />
      </span>
      {badge && <span className="agent-orb-badge">{badge}</span>}
    </span>
  );
}
