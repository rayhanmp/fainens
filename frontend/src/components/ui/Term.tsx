import { useState } from 'react';
import { cn } from '../../lib/utils';

const underline = 'group/term relative rounded-sm underline decoration-[var(--color-muted)] decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40';

/**
 * A word in running text with a dotted underline whose meaning shows on hover, focus or tap, as in
 * the help glossary. With `href` it's also a link, for a figure and the source it comes from.
 */
export function Term({ children, meaning, href }: { children: React.ReactNode; meaning: React.ReactNode; href?: string }) {
  // A word near the right edge opens its hint leftwards, so the hint isn't cut off.
  const [alignRight, setAlignRight] = useState(false);
  const place = (element: HTMLElement) => setAlignRight(element.getBoundingClientRect().left + 256 > window.innerWidth - 16);
  const hint = (
    // Not rendered until hovered or focused, so it never widens the page.
    <span role="tooltip" className={cn('pointer-events-none absolute bottom-full z-30 mb-2 hidden w-max max-w-[min(16rem,75vw)] rounded-lg bg-[var(--ref-on-surface)] px-3 py-2 text-left text-xs font-normal leading-relaxed text-[var(--color-surface)] no-underline shadow-lg group-hover/term:block group-focus/term:block', alignRight ? 'right-0' : 'left-0')}>
      {meaning}
    </span>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" onMouseEnter={(event) => place(event.currentTarget)} onFocus={(event) => place(event.currentTarget)} className={cn(underline, 'cursor-pointer hover:decoration-[var(--color-accent)]')}>
        {children}
        {hint}
      </a>
    );
  }
  return (
    <span tabIndex={0} onMouseEnter={(event) => place(event.currentTarget)} onFocus={(event) => place(event.currentTarget)} className={cn(underline, 'cursor-help')}>
      {children}
      {hint}
    </span>
  );
}
