import type { RecapStoryId } from './stories';

/** A small seeded generator: one run of the recap rolls its dice once, so a chapter looks the same
 * when you step back to it, while the next open or replay rolls new ones. */
export function seeded(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pickFrom = <T,>(items: readonly T[], random: () => number) => items[Math.floor(random() * items.length) % items.length];
const hash = (value: string) => [...value].reduce((sum, char) => Math.imul(sum ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);

export const TRANSITIONS = ['slide', 'drop', 'zoom', 'flip', 'spin', 'glitch', 'iris', 'blinds', 'curtain'] as const;
export type Transition = typeof TRANSITIONS[number] | 'rewind';
/** These paint the next chapter's colour over the card first, so the new content waits for them. */
export const OVERLAY_TRANSITIONS = new Set<Transition>(['iris', 'blinds', 'curtain', 'rewind']);
export const enterDelay = (transition: Transition) => OVERLAY_TRANSITIONS.has(transition) ? 420 : transition === 'flip' ? 260 : 120;

export function nextTransition(run: number, visit: number, previous: Transition): Transition {
  const random = seeded(run + visit * 7919);
  let choice: Transition = pickFrom(TRANSITIONS, random);
  if (choice === previous) choice = pickFrom(TRANSITIONS, random);
  return choice;
}

export const OPENINGS = ['split', 'zoom', 'shutter', 'spin'] as const;
export type Opening = typeof OPENINGS[number];

const sectionVariants = {
  intro: ['magazine', 'poster', 'vinyl', 'boarding'],
  categories: ['assemble', 'stack', 'grow'],
  calendar: ['ripple', 'diagonal', 'scatter', 'sweep'],
  receipts: ['print', 'toss', 'unroll'],
  comparison: ['race', 'rise'],
  closing: ['deal', 'flip'],
  burst: ['confetti', 'stars', 'coins'],
} as const satisfies Partial<Record<RecapStoryId | 'burst', readonly string[]>>;
export type SectionVariants = { [Key in keyof typeof sectionVariants]: typeof sectionVariants[Key][number] };

export function runVariants(run: number): SectionVariants & { opening: Opening } {
  const roll = (key: string) => seeded(run ^ hash(key));
  const entries = Object.entries(sectionVariants).map(([key, options]) => [key, pickFrom(options, roll(key))]);
  return { ...Object.fromEntries(entries) as SectionVariants, opening: pickFrom(OPENINGS, roll('opening')) };
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
