import type { PersonaKey, RecapStory, RecapStoryId } from './stories';
import type { GrooveScene } from './sfx';
import type { PartName } from './parts';

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
/** Set pieces between chapters: a train passing, lift doors, a chomper. Rare, and never on low-end phones. */
export const ELABORATE_TRANSITIONS = ['train', 'elevator', 'chomp'] as const;
/** Eye-candy scenes of about five seconds between chapters: fireworks, an aurora, the deep sea, a tile
 * mosaic, falling coins, a lava lamp. Rarer still, never twice in a row, and a tap skips one. */
export const SPECTACLE_TRANSITIONS = ['fireworks', 'aurora', 'deepsea', 'mosaic', 'coinfall', 'lavalamp'] as const;
export type Spectacle = typeof SPECTACLE_TRANSITIONS[number];
export type Transition = typeof TRANSITIONS[number] | typeof ELABORATE_TRANSITIONS[number] | Spectacle | 'rewind';
export const SPECTACLES = new Set<Transition>(SPECTACLE_TRANSITIONS);
/** How long a spectacle holds the card; the next chapter arrives as it clears. */
export const SPECTACLE_MS = 4_800;
/** These paint the next chapter's colour over the card first, so the new content waits for them. */
export const OVERLAY_TRANSITIONS = new Set<Transition>(['iris', 'blinds', 'curtain', 'rewind', ...ELABORATE_TRANSITIONS, ...SPECTACLE_TRANSITIONS]);
const ENTER_DELAYS: Partial<Record<Transition, number>> = { flip: 260, train: 1250, elevator: 1150, chomp: 1050,
  ...Object.fromEntries(SPECTACLE_TRANSITIONS.map(name => [name, SPECTACLE_MS - 500])) };
export const enterDelay = (transition: Transition) => ENTER_DELAYS[transition] ?? (OVERLAY_TRANSITIONS.has(transition) ? 420 : 120);

/** Phones with little memory or few cores get the same recap with lighter dice: no set-piece transitions. */
export const lowEndDevice = () => typeof navigator !== 'undefined'
  && (((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4);

export function nextTransition(run: number, visit: number, previous: Transition, lite = false): Transition {
  const random = seeded(run + visit * 7919);
  // About one move in twelve becomes a set piece and one in ten a spectacle, never two showpieces in a row.
  const showpiece = (ELABORATE_TRANSITIONS as readonly string[]).includes(previous) || SPECTACLES.has(previous);
  if (!lite && visit > 1 && !showpiece) {
    const roll = random();
    if (roll < .085) return pickFrom(ELABORATE_TRANSITIONS, random);
    if (roll < .185) return pickFrom(SPECTACLE_TRANSITIONS, random);
  }
  let choice: Transition = pickFrom(TRANSITIONS, random);
  if (choice === previous) choice = pickFrom(TRANSITIONS, random);
  return choice;
}

export const OPENINGS = ['split', 'zoom', 'shutter', 'spin', 'crawl', 'vhs', 'needle', 'news', 'start'] as const;
export type Opening = typeof OPENINGS[number];
/** How long each opening holds the cover back; a tap skips the long ones. */
export const OPENING_DURATIONS: Partial<Record<Opening, number>> = { crawl: 10_500, vhs: 2_300, needle: 2_400, news: 2_600, start: 2_400 };

/** Whole-run editions restyle every chapter the same way: type, rules, texture. `none` is the house style. */
export const EDITIONS = ['none', 'none', 'newspaper', 'bits', 'y2k', 'zine', 'brutalist'] as const;
export type Edition = typeof EDITIONS[number];
/** How long the run is: every chapter, the usual, or a quick lap. */
export const CUTS = ['standard', 'standard', 'standard', 'directors', 'speedrun'] as const;
export type Cut = typeof CUTS[number];
/** The music mode's groove, per run. The 8-bit edition always brings chiptune. */
export const SOUND_PACKS = ['groove', 'lofi', 'chip', 'orchestral', 'koplo', 'synthwave', 'bossa', 'trap', 'gamelan', 'jazz', 'disco',
  'reggaeton', 'amapiano', 'citypop', 'funk', 'reggae', 'dnb', 'musicbox', 'kroncong'] as const;
export type SoundPack = typeof SOUND_PACKS[number];

/** Each money personality has a theme tune the music switches to when it is revealed. */
export const PERSONA_THEME_PACKS: Record<PersonaKey, SoundPack> = {
  weekend: 'disco', monk: 'gamelan', bigTicket: 'trap', steady: 'bossa', loyal: 'chip', devotee: 'orchestral', explorer: 'synthwave', allRounder: 'jazz',
};

/**
 * What the music does on a chapter. The opening and the credits play sparse; the middle grooves; bonus
 * slides and showpieces bring in the lead; a mini-game drops to keys alone while it waits for an answer;
 * the personality reveal plays its own theme. The chords turn minor only where the figures do (out
 * ran past in, the budget went over, the boss fight, the ejection), never as a verdict on ordinary
 * chapters.
 */
export function grooveScene(story: RecapStory, waiting: boolean): GrooveScene {
  if (waiting) return { energy: 0, mood: 'dark' };
  switch (story.id) {
    case 'intro': case 'closing': return { energy: 1, mood: 'bright' };
    case 'persona': return { energy: 3, mood: 'bright', pack: PERSONA_THEME_PACKS[story.persona.key] };
    case 'bonus': return { energy: 3, mood: story.bonus.kind === 'boss' ? 'dark' : 'bright' };
    case 'interlude': return story.variant === 'ejected' ? { energy: 0, mood: 'dark' } : { energy: 3, mood: 'bright' };
    case 'overview': return { energy: 2, mood: story.net < 0 ? 'dark' : 'bright' };
    case 'budget': return { energy: 2, mood: story.remaining < 0 ? 'dark' : 'bright' };
    default: return { energy: 2, mood: 'bright' };
  }
}

const sectionVariants = {
  intro: ['magazine', 'poster', 'vinyl', 'boarding', 'ticket', 'passport', 'photostrip', 'cartridge', 'postcard', 'cereal', 'novel', 'tearoff', 'lineup', 'comic'],
  categories: ['assemble', 'stack', 'grow'],
  calendar: ['ripple', 'diagonal', 'scatter', 'sweep'],
  receipts: ['print', 'toss', 'unroll'],
  comparison: ['race', 'rise'],
  overview: ['bars', 'scale', 'coins', 'donut', 'bucket'],
  budget: ['meter', 'gauge'],
  versus: ['bars', 'versus'],
  closing: ['deal', 'flip'],
  finale: ['card', 'receipt', 'credits', 'certificate', 'scoreboard', 'polaroid', 'trading', 'frontpage', 'post', 'trophy', 'museum', 'weather', 'snowglobe'],
  burst: ['confetti', 'stars', 'coins'],
  // Second (and third) looks for chapters that had one layout. The first option is the house layout.
  weekdays: ['bars', 'clock', 'podium', 'planner'],
  streak: ['strip', 'chain', 'domino', 'combo'],
  habits: ['trio', 'pile', 'cart', 'tally'],
  mixtape: ['cassette', 'vinyl', 'cd', 'nowplaying'],
  months: ['bars', 'wheel', 'skyline', 'heat'],
  persona: ['scene', 'scene', 'alt'],
  bonus: ['classic', 'alt'],
} as const satisfies Partial<Record<RecapStoryId | 'burst' | 'finale' | 'versus', readonly string[]>>;
export type SectionVariants = { [Key in keyof typeof sectionVariants]: typeof sectionVariants[Key][number] };
export type RunVariants = SectionVariants & { opening: Opening; edition: Edition; cut: Cut; pack: SoundPack; lite: boolean };

export function runVariants(run: number, lite = false): RunVariants {
  const roll = (key: string) => seeded(run ^ hash(key));
  const entries = Object.entries(sectionVariants).map(([key, options]) => [key, pickFrom(options, roll(key))]);
  const edition = pickFrom(EDITIONS, roll('edition'));
  return { ...Object.fromEntries(entries) as SectionVariants, opening: pickFrom(OPENINGS, roll('opening')), edition, cut: pickFrom(CUTS, roll('cut')),
    pack: edition === 'bits' ? 'chip' : pickFrom(SOUND_PACKS, roll('pack')), lite };
}

/** The lazily loaded groups a run needs, so they can load during the opening. See parts.ts. */
export function runParts(variants: RunVariants) {
  const parts = new Set<PartName>();
  if (variants.weekdays !== 'bars' || variants.streak !== 'strip' || variants.habits !== 'trio' || variants.mixtape !== 'cassette' || variants.months !== 'bars') parts.add('layouts');
  if (variants.persona === 'alt') parts.add('persona');
  if (variants.bonus === 'alt') parts.add('bonus');
  if (['polaroid', 'trading', 'frontpage', 'post', 'trophy', 'museum', 'weather', 'snowglobe'].includes(variants.finale)) parts.add('finales');
  return parts;
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
    // Retired: in the top corners stickers hit the header, and anywhere lower they land on the chart.
    sticker: null,
    tempo: roll([.8, 1, 1.25] as const, [1, 2, 1]),
    blob: { x: Math.round(random() * 100), y: Math.round(random() * 100) },
  };
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
