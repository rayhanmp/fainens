import { memo, type CSSProperties } from 'react';
import { seeded } from './motion';

const colors = ['#ff5a5f', '#ffb400', '#00b3a4', '#7b61ff', '#2f80ff', '#ff7ac6', 'var(--recap-ink)'];

/**
 * Celebration particles. Every particle gets its own flight from a seeded roll, so a replay throws a
 * different burst. `confetti` mixes ribbons and dots, `stars` throws the brand ✳, `coins` rains gold.
 * Memoised: the particles depend only on the props, so the viewer's other updates skip them.
 */
export const Burst = memo(function Burst({ seed, kind, count = 46, origin = 'center', delay = 0 }: {
  seed: number; kind: 'confetti' | 'stars' | 'coins' | 'sparkle'; count?: number; origin?: 'center' | 'cannons' | 'title'; delay?: number;
}) {
  const random = seeded(seed);
  const particles = Array.from({ length: count }, (_, i) => {
    // Cannons fire from both lower corners towards the middle; the others explode outwards.
    const side = origin === 'cannons' ? (i % 2 ? 1 : -1) : 0;
    const angle = origin === 'cannons' ? (side < 0 ? -65 : -115) + (random() - .5) * 40 : random() * 360;
    const power = (origin === 'title' ? 18 : 38) + random() * (origin === 'title' ? 20 : 42);
    const radians = angle * Math.PI / 180;
    return {
      x: Math.cos(radians) * power, y: Math.sin(radians) * power * (origin === 'cannons' ? 1.6 : 1),
      fall: 30 + random() * 50, spin: (random() - .5) * 1080, size: .8 + random() * .9,
      color: colors[Math.floor(random() * colors.length)], wait: delay + random() * 180, side,
      shape: kind === 'confetti' ? (random() > .45 ? 'ribbon' : 'dot') : kind,
    };
  });
  return <div className={`recap-burst recap-burst-${origin}`} aria-hidden="true">
    {particles.map((p, i) => <i key={i} className={`recap-particle recap-particle-${p.shape}`}
      style={{ '--x': `${p.x}cqw`, '--y': `${p.y}cqw`, '--fall': `${p.fall}cqw`, '--spin': `${p.spin}deg`, '--size': p.size, '--c': p.color, '--wait': `${p.wait}ms`, '--side': p.side } as CSSProperties}>
      {p.shape === 'stars' || p.shape === 'sparkle' ? '✳' : p.shape === 'coins' ? 'Rp' : null}
    </i>)}
  </div>;
});
