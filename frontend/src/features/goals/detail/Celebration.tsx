import type { CSSProperties } from 'react';

const COLORS = ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa', '#ffffff'];

/**
 * A short burst of confetti over the goal's card when it reaches a quarter of its target, with
 * the words for it. Still for anyone who asks for reduced motion; it clears itself after a moment.
 */
export function Celebration({ share, name, seed }: { share: 25 | 50 | 75 | 100; name: string; seed: number }) {
  const pieces = Array.from({ length: 28 }, (_, index) => {
    // A cheap seeded spread, so each celebration looks a little different.
    const angle = ((index * 137.5 + seed * 53) % 360) * (Math.PI / 180);
    const power = 90 + ((index * 31 + seed * 7) % 70);
    return {
      x: Math.cos(angle) * power,
      y: Math.sin(angle) * power * 0.7 - 30,
      color: COLORS[index % COLORS.length],
      spin: ((index * 97) % 540) - 270,
      delay: (index % 6) * 30,
      round: index % 3 === 0,
    };
  });
  const words = share === 100 ? `${name} is all there!` : share === 50 ? `${name} is halfway there!` : `${name} is ${share}% there!`;
  return (
    <div className="goal-celebration pointer-events-none absolute inset-0 z-10 grid place-items-center overflow-hidden" role="status" aria-live="polite">
      {pieces.map((piece, index) => (
        <i
          key={index}
          className={piece.round ? 'goal-confetti goal-confetti-dot' : 'goal-confetti'}
          style={{ '--x': `${piece.x}px`, '--y': `${piece.y}px`, '--spin': `${piece.spin}deg`, '--c': piece.color, animationDelay: `${piece.delay}ms` } as CSSProperties}
          aria-hidden
        />
      ))}
      <span className="goal-celebration-words rounded-full bg-[#fff] px-4 py-2 font-headline text-sm font-extrabold text-[#0b2a5c] shadow-lg">🎉 {words}</span>
    </div>
  );
}
