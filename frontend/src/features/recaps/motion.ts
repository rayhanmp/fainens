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

export const OPENINGS = ['split', 'zoom', 'shutter', 'spin', 'crawl'] as const;
export type Opening = typeof OPENINGS[number];

const sectionVariants = {
  intro: ['magazine', 'poster', 'vinyl', 'boarding'],
  categories: ['assemble', 'stack', 'grow'],
  calendar: ['ripple', 'diagonal', 'scatter', 'sweep'],
  receipts: ['print', 'toss', 'unroll'],
  comparison: ['race', 'rise'],
  overview: ['bars', 'scale', 'coins', 'donut', 'bucket'],
  budget: ['meter', 'gauge'],
  versus: ['bars', 'versus'],
  closing: ['deal', 'flip'],
  finale: ['card', 'receipt', 'credits', 'certificate', 'scoreboard'],
  burst: ['confetti', 'stars', 'coins'],
} as const satisfies Partial<Record<RecapStoryId | 'burst' | 'finale' | 'versus', readonly string[]>>;
export type SectionVariants = { [Key in keyof typeof sectionVariants]: typeof sectionVariants[Key][number] };

export function runVariants(run: number): SectionVariants & { opening: Opening } {
  const roll = (key: string) => seeded(run ^ hash(key));
  const entries = Object.entries(sectionVariants).map(([key, options]) => [key, pickFrom(options, roll(key))]);
  return { ...Object.fromEntries(entries) as SectionVariants, opening: pickFrom(OPENINGS, roll('opening')) };
}

/**
 * A style remix rolled for every chapter of a run, layered over its own design: how the headline is set,
 * where it sits, a background pattern, a frame, a sticker and the tempo of its entrance. Mixed together
 * they make thousands of combinations, so the same chapter rarely looks the same twice.
 */
export type ChapterStyle = {
  title: 'plain' | 'label' | 'serif' | 'caps' | 'highlight' | 'mixed';
  align: 'left' | 'center';
  pattern: 'none' | 'dots' | 'grid' | 'stripes' | 'blobs' | 'halftone';
  frame: 'none' | 'border' | 'corners';
  tilt: number;
  mark: number;
  sticker: { text: string; corner: 'tl' | 'tr' | 'br'; spin: number } | null;
  tempo: number;
  blob: { x: number; y: number };
};

export function chapterStyle(run: number, key: string): ChapterStyle {
  const random = seeded((run ^ hash(key)) + 13);
  const roll = <T,>(items: readonly T[], weights: readonly number[]) => {
    let pick = random() * weights.reduce((sum, w) => sum + w, 0);
    for (let i = 0; i < items.length; i++) { pick -= weights[i]; if (pick <= 0) return items[i]; }
    return items[items.length - 1];
  };
  // Without a run (first paint, the share card) every chapter keeps its house style.
  if (run === 0) return { title: 'plain', align: 'left', pattern: 'none', frame: 'none', tilt: 0, mark: 0, sticker: null, tempo: 1, blob: { x: 70, y: 20 } };
  return {
    title: roll(['plain', 'label', 'serif', 'caps', 'highlight', 'mixed'] as const, [3, 1, 1.2, 1, 1.6, 1.2]),
    align: roll(['left', 'center'] as const, [3, 1]),
    pattern: roll(['none', 'dots', 'grid', 'stripes', 'blobs', 'halftone'] as const, [2.5, 1, 1, .8, 1, .8]),
    frame: roll(['none', 'border', 'corners'] as const, [4, 1, 1]),
    // Kept small: a wide headline tilted further would dip its corner into the block below.
    tilt: random() < .3 ? Math.round((random() - .5) * 30) / 10 : 0,
    mark: Math.floor(random() * 6),
    sticker: random() < .22 ? { text: pickFrom(['NEW!', 'WOW', 'FRESH', 'HOT', 'LIVE', 'OMG', 'YAY', 'NICE', '✳✳✳'], random), corner: pickFrom(['tl', 'tr', 'br'] as const, random), spin: Math.round((random() - .5) * 40) } : null,
    tempo: roll([.8, 1, 1.25] as const, [1, 2, 1]),
    blob: { x: Math.round(random() * 100), y: Math.round(random() * 100) },
  };
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
