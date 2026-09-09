import { cn } from '../../lib/utils';

export type AgentOrbState = 'idle' | 'ready' | 'thinking' | 'error';

/** Visual identity only; the trigger or adjacent text supplies its accessible label. */
export function AgentOrb({ active = false, state, className }: { active?: boolean; state?: AgentOrbState; className?: string }) {
  return (
    <span aria-hidden="true" data-state={state ?? (active ? 'thinking' : 'idle')} className={cn('agent-orb', className)}>
      <span className="agent-orb-halo" />
      <span className="agent-orb-shell">
        <span className="agent-orb-flow" />
        <span className="agent-orb-ribbon" />
        <span className="agent-orb-core" />
      </span>
      <span className="agent-orb-orbit" />
    </span>
  );
}
